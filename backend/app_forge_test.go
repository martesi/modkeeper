package backend

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/forge"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/testenv"
)

func newForgeTestApp(t *testing.T) (*App, *testenv.Env, string, string) {
	t.Helper()
	env := testenv.New(t)
	app := NewAppAt(filepath.Join(t.TempDir(), "config.toml"))
	if app.InitErr != nil {
		t.Fatalf("NewAppAt: %v", app.InitErr)
	}
	libraryRoot := filepath.Join(env.Root, "library")
	workspace, err := app.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &libraryRoot})
	if err != nil {
		t.Fatalf("CreateLibrary: %v", err)
	}
	if workspace.ActiveLibraryID == nil {
		t.Fatal("library was not activated")
	}
	return app, env, libraryRoot, *workspace.ActiveLibraryID
}

// persistedMods reads the library manifest because the workspace projection is
// owned by the wails-workspace change. After that branch merges, assert Forge
// identity on the returned workspace instead.
func persistedMods(t *testing.T, libraryRoot string) map[string]models.Mod {
	t.Helper()
	var manifest struct {
		Mods map[string]models.Mod `toml:"mods"`
	}
	if _, err := toml.DecodeFile(filepath.Join(libraryRoot, "manifest.toml"), &manifest); err != nil {
		t.Fatalf("manifest: %v", err)
	}
	return manifest.Mods
}

func forgePage(w http.ResponseWriter, id int, guid, name string) {
	fmt.Fprintf(w, `{"data":[{"id":%d,"guid":%q,"name":%q}],"meta":{"current_page":1,"last_page":2,"per_page":10,"total":11}}`, id, guid, name)
}

func TestBoundForgeReadsReturnOneObjectWithKindAndPage(t *testing.T) {
	app, _, _, _ := newForgeTestApp(t)
	var mu sync.Mutex
	pages := map[string]string{}
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		pages[r.URL.Path] = r.URL.Query().Get("page")
		mu.Unlock()
		switch r.URL.Path {
		case "/mods":
			forgePage(w, 1, "mod-1", "Mod One")
		case "/addons":
			forgePage(w, 2, "addon-2", "Addon Two")
		case "/mod/7":
			fmt.Fprint(w, `{"data":{"id":7,"guid":"mod-7","name":"Detail Mod","detail_url":"https://example.test/mod/7"}}`)
		case "/addon/9":
			fmt.Fprint(w, `{"data":{"id":9,"guid":"addon-9","name":"Detail Addon","mod_id":7,"is_detached":true}}`)
		case "/mod/7/versions":
			fmt.Fprint(w, `{"data":[{"id":70,"version":"2.0.0","link":"https://example.test/a.zip","content_length":10}],"meta":{"current_page":2}}`)
		case "/addon/9/versions":
			fmt.Fprint(w, `{"data":[{"id":90,"version":"1.0.0","link":"https://example.test/b.zip","content_length":20}],"meta":{"current_page":3}}`)
		default:
			http.NotFound(w, r)
		}
	})
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	app.Forge.BaseURL = server.URL

	t.Run("search", func(t *testing.T) {
		body, err := app.ForgeSearch("query", 2, 3, 10)
		if err != nil {
			t.Fatal(err)
		}
		var page map[string]any
		if err := json.Unmarshal(body, &page); err != nil {
			t.Fatalf("single object expected: %s: %v", body, err)
		}
		if page["sptVersion"] != "4.0.11" {
			t.Fatalf("sptVersion: %v", page["sptVersion"])
		}
		for _, key := range []string{"mods", "addons"} {
			items, ok := page[key].(map[string]any)
			if !ok {
				t.Fatalf("%s is not an object: %v", key, page[key])
			}
			if stale, ok := items["stale"].(bool); !ok || stale {
				t.Fatalf("%s stale: %v", key, items["stale"])
			}
		}
		mu.Lock()
		modPage, addonPage := pages["/mods"], pages["/addons"]
		mu.Unlock()
		if modPage != "2" || addonPage != "3" {
			t.Fatalf("search pages: mod=%q addon=%q", modPage, addonPage)
		}
	})

	t.Run("mod detail", func(t *testing.T) {
		body, err := app.ForgeModDetail("mod", 7)
		if err != nil {
			t.Fatal(err)
		}
		var detail map[string]any
		if err := json.Unmarshal(body, &detail); err != nil {
			t.Fatalf("single object expected: %s: %v", body, err)
		}
		if detail["kind"] != "mod" || detail["id"] != float64(7) || detail["stale"] != false {
			t.Fatalf("detail: %v", detail)
		}
	})

	t.Run("addon detail", func(t *testing.T) {
		body, err := app.ForgeModDetail("addon", 9)
		if err != nil {
			t.Fatal(err)
		}
		var detail map[string]any
		if err := json.Unmarshal(body, &detail); err != nil {
			t.Fatalf("single object expected: %s: %v", body, err)
		}
		if detail["kind"] != "addon" || detail["id"] != float64(9) || detail["parentModId"] != float64(7) {
			t.Fatalf("addon detail: %v", detail)
		}
	})

	t.Run("mod versions", func(t *testing.T) {
		body, err := app.ForgeModVersions("mod", 7, 2)
		if err != nil {
			t.Fatal(err)
		}
		var page map[string]any
		if err := json.Unmarshal(body, &page); err != nil {
			t.Fatalf("single object expected: %s: %v", body, err)
		}
		if page["kind"] != "mod" || page["itemId"] != float64(7) || page["stale"] != false {
			t.Fatalf("versions page: %v", page)
		}
		mu.Lock()
		got := pages["/mod/7/versions"]
		mu.Unlock()
		if got != "2" {
			t.Fatalf("versions page: %q", got)
		}
	})

	t.Run("addon versions", func(t *testing.T) {
		body, err := app.ForgeAddonVersions(9, 3)
		if err != nil {
			t.Fatal(err)
		}
		var page map[string]any
		if err := json.Unmarshal(body, &page); err != nil {
			t.Fatalf("single object expected: %s: %v", body, err)
		}
		if page["kind"] != "addon" || page["itemId"] != float64(9) || page["stale"] != false {
			t.Fatalf("addon versions page: %v", page)
		}
		mu.Lock()
		got := pages["/addon/9/versions"]
		mu.Unlock()
		if got != "3" {
			t.Fatalf("addon versions page: %q", got)
		}
	})
}

func TestBoundForgeReadsFailWithoutActiveLibrary(t *testing.T) {
	app := NewAppAt(filepath.Join(t.TempDir(), "config.toml"))
	if app.InitErr != nil {
		t.Fatal(app.InitErr)
	}
	for _, call := range []struct {
		name string
		call func() (json.RawMessage, error)
	}{
		{"search", func() (json.RawMessage, error) { return app.ForgeSearch("", 1, 1, 20) }},
		{"detail", func() (json.RawMessage, error) { return app.ForgeModDetail("mod", 1) }},
		{"versions", func() (json.RawMessage, error) { return app.ForgeModVersions("mod", 1, 1) }},
	} {
		t.Run(call.name, func(t *testing.T) {
			_, err := call.call()
			var coded *models.Error
			if !errors.As(err, &coded) || coded.Code != models.NoActiveLibrary {
				t.Fatalf("expected NoActiveLibrary, got %v", err)
			}
		})
	}
}

func TestForgeMatchInstalledModReturnsWorkspace(t *testing.T) {
	app, _, libraryRoot, libraryID := newForgeTestApp(t)
	archive := writeModArchiveContent(t, "MatchTarget.dll", "match payload")
	if _, err := app.InstallModArchives(models.InstallModArchivesInput{TaskID: "match-install", LibraryID: libraryID, ArchivePaths: []string{archive}}); err != nil {
		t.Fatal(err)
	}
	app.Library.Wait()
	before, err := app.GetLibraryWorkspace()
	if err != nil {
		t.Fatal(err)
	}
	mods := before.ModsByLibraryID[libraryID]
	if len(mods) != 1 {
		t.Fatalf("installed mods: %d", len(mods))
	}
	installedID := mods[0].ID

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/versions") {
			fmt.Fprint(w, `{"data":[{"id":2,"version":"1.2.0","link":"https://example.test/a.zip","content_length":0}]}`)
			return
		}
		fmt.Fprint(w, `{"data":{"id":1,"guid":"forge-guid","name":"Forge Mod"}}`)
	}))
	t.Cleanup(server.Close)
	app.Forge.BaseURL = server.URL

	workspace, err := app.ForgeMatchInstalledMod(forge.ForgeMatchInstalledModInput{LibraryID: libraryID, InstalledModID: installedID, Kind: "mod", ItemID: 1, VersionID: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(workspace.ModsByLibraryID[libraryID]) != 1 || workspace.ModsByLibraryID[libraryID][0].ID != installedID {
		t.Fatalf("workspace: %+v", workspace.ModsByLibraryID[libraryID])
	}
	matched, ok := persistedMods(t, libraryRoot)[installedID]
	if !ok {
		t.Fatal("matched mod is missing from the manifest")
	}
	if matched.Source != models.ModSourceForge {
		t.Fatalf("source: %v", matched.Source)
	}
	if matched.Version == nil || *matched.Version != "1.2.0" {
		t.Fatalf("version: %v", matched.Version)
	}
	if matched.ForgeID == nil || *matched.ForgeID != 1 {
		t.Fatalf("forge id: %v", matched.ForgeID)
	}
	if matched.ForgeGUID == nil || *matched.ForgeGUID != "forge-guid" {
		t.Fatalf("forge guid: %v", matched.ForgeGUID)
	}
	if matched.ForgeKind == nil || *matched.ForgeKind != models.ForgeKindMod {
		t.Fatalf("forge kind: %v", matched.ForgeKind)
	}
	if matched.ForgeVersionID == nil || *matched.ForgeVersionID != 2 {
		t.Fatalf("forge version id: %v", matched.ForgeVersionID)
	}
	if matched.Name == "" || matched.ForgeMetaCachedAt == nil {
		t.Fatalf("matched mod lost local identity: %+v", matched)
	}
}

func TestForgeDownloadRunsRealHooksAndCompletesTask(t *testing.T) {
	env := testenv.New(t)
	sink := &captureSink{}
	app := NewAppAt(filepath.Join(t.TempDir(), "config.toml"))
	if app.InitErr != nil {
		t.Fatal(app.InitErr)
	}
	app.Sink = sink
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	libraryRoot := filepath.Join(env.Root, "library")
	workspace, err := app.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &libraryRoot})
	if err != nil {
		t.Fatal(err)
	}
	libraryID := *workspace.ActiveLibraryID

	archive, err := os.ReadFile(writeModArchiveContent(t, "ForgeDownloaded.dll", "download payload"))
	if err != nil {
		t.Fatal(err)
	}
	var baseURL string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/mod/1":
			fmt.Fprint(w, `{"data":{"id":1,"guid":"download-guid","name":"Downloaded"}}`)
		case r.URL.Path == "/mod/1/versions":
			fmt.Fprintf(w, `{"data":[{"id":2,"version":"3.1.4","link":%q,"content_length":%d}]}`, baseURL+"/archive.zip", len(archive))
		case r.URL.Path == "/archive.zip":
			w.Header().Set("Content-Disposition", `attachment; filename="ForgeDownloaded.zip"`)
			_, _ = w.Write(archive)
		default:
			http.NotFound(w, r)
		}
	}))
	baseURL = server.URL
	t.Cleanup(server.Close)
	app.Forge.BaseURL = server.URL

	input := forge.ForgeDownloadVersionInput{TaskID: "forge-download", LibraryID: libraryID, Kind: "mod", ItemID: 1, VersionID: 2}
	accepted, err := app.ForgeDownloadVersion(input)
	if err != nil {
		t.Fatal(err)
	}
	if string(accepted) != `{"accepted":true}` {
		t.Fatalf("accepted: %s", accepted)
	}
	app.Library.Wait()

	if len(sink.workspaces) != 1 {
		t.Fatalf("workspace events: %d", len(sink.workspaces))
	}
	event := sink.workspaces[0]
	if event.Type != models.WorkspaceEventModInstallCompleted || event.TaskID != input.TaskID || event.LibraryID != libraryID {
		t.Fatalf("completion event: %+v", event)
	}
	if failures, ok := event.Failures.([]models.ArchiveFailure); !ok || len(failures) != 0 {
		t.Fatalf("completion failures: %#v", event.Failures)
	}
	mods := event.Workspace.ModsByLibraryID[libraryID]
	if len(mods) != 1 {
		t.Fatalf("workspace mods: %d", len(mods))
	}
	workspaceMod := mods[0]
	if workspaceMod.InstalledPath == nil {
		t.Fatal("installed mod has no path")
	}
	if _, err := os.Stat(filepath.Join(*workspaceMod.InstalledPath, "SPT", "user", "mods", "ForgeDownloaded", "ForgeDownloaded.dll")); err != nil {
		t.Fatalf("installed file: %v", err)
	}
	mod, ok := persistedMods(t, libraryRoot)[workspaceMod.ID]
	if !ok {
		t.Fatal("downloaded mod is missing from the manifest")
	}
	if mod.Version == nil || *mod.Version != "3.1.4" || mod.ForgeGUID == nil || *mod.ForgeGUID != "download-guid" {
		t.Fatalf("installed mod: %+v", mod)
	}
	if mod.ForgeVersionID == nil || *mod.ForgeVersionID != 2 || mod.ForgeKind == nil || *mod.ForgeKind != models.ForgeKindMod {
		t.Fatalf("installed forge identity: %+v", mod)
	}
	for _, dir := range []string{"staging", "backups"} {
		entries, err := os.ReadDir(filepath.Join(libraryRoot, dir))
		if err != nil || len(entries) != 0 {
			t.Fatalf("%s entries=%v err=%v", dir, entries, err)
		}
	}

	sawForgeStage := false
	for _, progress := range sink.progress {
		if progress.Stage == models.TaskStageInstallArchiveStage {
			t.Fatal("Forge install emitted a generic archive stage")
		}
		if progress.Stage == models.TaskStageForgeDownload {
			sawForgeStage = true
		}
	}
	if !sawForgeStage {
		t.Fatal("download progress was not forwarded")
	}

	// Complete must emit before Release frees the task ID.
	err = app.CancelTask(input.TaskID, libraryID)
	var coded *models.Error
	if !errors.As(err, &coded) || coded.Code != models.TaskNotFound {
		t.Fatalf("task id was not released: %v", err)
	}
}

func TestForgeDownloadFailureCarriesArchiveFailure(t *testing.T) {
	env := testenv.New(t)
	sink := &captureSink{}
	app := NewAppAt(filepath.Join(t.TempDir(), "config.toml"))
	if app.InitErr != nil {
		t.Fatal(app.InitErr)
	}
	app.Sink = sink
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	libraryRoot := filepath.Join(env.Root, "library")
	workspace, err := app.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &libraryRoot})
	if err != nil {
		t.Fatal(err)
	}
	libraryID := *workspace.ActiveLibraryID
	var baseURL string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/mod/1/versions":
			fmt.Fprintf(w, `{"data":[{"id":2,"version":"1.0.0","link":%q,"content_length":4}]}`, baseURL+"/broken.zip")
		case r.URL.Path == "/mod/1":
			fmt.Fprint(w, `{"data":{"id":1,"guid":"g","name":"n"}}`)
		case r.URL.Path == "/broken.zip":
			fmt.Fprint(w, "abc")
		default:
			http.NotFound(w, r)
		}
	}))
	baseURL = server.URL
	t.Cleanup(server.Close)
	app.Forge.BaseURL = server.URL

	input := forge.ForgeDownloadVersionInput{TaskID: "forge-fail", LibraryID: libraryID, Kind: "mod", ItemID: 1, VersionID: 2}
	if _, err := app.ForgeDownloadVersion(input); err != nil {
		t.Fatal(err)
	}
	app.Library.Wait()
	if len(sink.workspaces) != 1 {
		t.Fatalf("workspace events: %d", len(sink.workspaces))
	}
	failures, ok := sink.workspaces[0].Failures.([]models.ArchiveFailure)
	if !ok || len(failures) != 1 {
		t.Fatalf("failures: %#v", sink.workspaces[0].Failures)
	}
	if failures[0].ArchivePath != "forge:Mod:1:2" || failures[0].Error.Code != "ParseError" {
		t.Fatalf("failure: %+v", failures[0])
	}
}
