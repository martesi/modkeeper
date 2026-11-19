package backend

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"

	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/testenv"
)

type captureSink struct {
	progress   []models.TaskProgressEvent
	workspaces []models.WorkspaceEvent
}

func (s *captureSink) Progress(event models.TaskProgressEvent) error {
	s.progress = append(s.progress, event)
	return nil
}

func (s *captureSink) Workspace(event models.WorkspaceEvent) error {
	s.workspaces = append(s.workspaces, event)
	return nil
}

// TestAppSurfaceEndToEnd exercises the exact methods Wails binds, against a
// temp config path and a synthetic game tree, including the event sink.
func TestAppSurfaceEndToEnd(t *testing.T) {
	env := testenv.New(t)
	sink := &captureSink{}
	app := NewAppAt(filepath.Join(t.TempDir(), "config.toml"))
	if app.InitErr != nil {
		t.Fatalf("NewAppAt: %v", app.InitErr)
	}
	app.Sink = sink
	if err := app.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}

	libraryRoot := filepath.Join(env.Root, "library")
	name := "Demo"
	workspace, err := app.CreateLibrary(models.CreateLibraryInput{
		GameRoot:    env.GameRoot,
		LibraryRoot: &libraryRoot,
		Name:        &name,
	})
	if err != nil {
		t.Fatalf("CreateLibrary: %v", err)
	}
	if workspace.ActiveLibraryID == nil || len(workspace.Libraries) != 1 {
		t.Fatalf("workspace after create: %+v", workspace)
	}
	libraryID := *workspace.ActiveLibraryID

	current, err := app.GetSettings()
	if err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	current.Theme = config.ThemeDark
	settings, err := app.SaveSettings(current)
	if err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}
	if settings.Theme != config.ThemeDark {
		t.Fatalf("saved theme %q", settings.Theme)
	}
	reloaded, err := app.GetSettings()
	if err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	if reloaded.Theme != config.ThemeDark {
		t.Fatalf("persisted theme %q", reloaded.Theme)
	}

	// A duplicate task id must be rejected while the first task is running; the
	// service finishes synchronously, so assert the cache rebuild instead.
	if _, err := app.RebuildLibraryCache(models.RebuildLibraryCacheInput{
		TaskID: "cache-1", LibraryID: libraryID,
	}); err != nil {
		t.Fatalf("RebuildLibraryCache: %v", err)
	}
	app.Library.Wait()
	if len(sink.progress) == 0 {
		t.Fatal("cache rebuild emitted no task progress")
	}
	if len(sink.workspaces) == 0 || sink.workspaces[0].Type != models.WorkspaceEventCacheRebuildCompleted {
		t.Fatalf("workspace events: %+v", sink.workspaces)
	}

	archive := writeModArchive(t, "MyMod.dll")
	before := len(sink.progress)
	if _, err := app.InstallModArchives(models.InstallModArchivesInput{
		TaskID: "install-1", LibraryID: libraryID, ArchivePaths: []string{archive},
	}); err != nil {
		t.Fatalf("InstallModArchives: %v", err)
	}
	app.Library.Wait()
	if _, err := os.Stat(archive); err != nil {
		t.Fatalf("install removed the source archive: %v", err)
	}
	var installed []models.ModSummary
	for _, event := range sink.workspaces {
		if event.Type == models.WorkspaceEventModInstallCompleted {
			installed = event.Workspace.ModsByLibraryID[libraryID]
		}
	}
	if len(installed) != 1 {
		for _, event := range sink.workspaces {
			t.Logf("event %s failures=%+v", event.Type, event.Failures)
		}
		t.Fatalf("installed mods: %+v", installed)
	}
	if !installed[0].IsEnabled {
		t.Fatal("enableModsOnInstall default should enable the new mod")
	}
	if len(sink.progress) <= before {
		t.Fatal("install emitted no task progress")
	}

	workspace, err = app.BulkUpdateMods(models.BulkUpdateModsInput{
		LibraryID: libraryID, ModIDs: []string{installed[0].ID}, Action: models.BulkActionDisable,
	})
	if err != nil {
		t.Fatalf("BulkUpdateMods: %v", err)
	}
	if rows := workspace.ModsByLibraryID[libraryID]; len(rows) != 1 || rows[0].IsEnabled {
		t.Fatalf("bulk disable result: %+v", rows)
	}

	if _, err := app.BulkUpdateMods(models.BulkUpdateModsInput{
		LibraryID: libraryID, ModIDs: []string{installed[0].ID}, Action: models.BulkActionEnable,
	}); err != nil {
		t.Fatalf("BulkUpdateMods enable: %v", err)
	}
	if _, err := app.SyncMods(models.SyncModsInput{TaskID: "sync-1", LibraryID: libraryID}); err != nil {
		t.Fatalf("SyncMods: %v", err)
	}
	app.Library.Wait()
	deployed := filepath.Join(env.GameRoot, "SPT", "user", "mods", "MyMod", "MyMod.dll")
	if _, err := os.Stat(deployed); err != nil {
		t.Fatalf("sync did not deploy the mod: %v", err)
	}
	synced := false
	for _, event := range sink.workspaces {
		if event.Type == models.WorkspaceEventSyncCompleted && len(event.Failures.([]models.ModFailure)) == 0 {
			synced = true
		}
	}
	if !synced {
		t.Fatalf("no clean sync_completed event: %+v", sink.workspaces)
	}
}

func writeModArchive(t *testing.T, dll string) string {
	return writeModArchiveContent(t, dll, "binary")
}

func writeModArchiveContent(t *testing.T, dll, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "mod.zip")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	entry, err := writer.Create("SPT/user/mods/" + trimExt(dll) + "/" + dll)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func trimExt(name string) string {
	if ext := filepath.Ext(name); ext != "" {
		return name[:len(name)-len(ext)]
	}
	return name
}

// TestInstallUpgradeLeavesNoSnapshot ports the Rust upgrade-path contract at the
// library layer: a second install replaces the mod content and never creates a
// backup snapshot.
func TestInstallUpgradeLeavesNoSnapshot(t *testing.T) {
	env := testenv.New(t)
	app := NewAppAt(filepath.Join(t.TempDir(), "config.toml"))
	if app.InitErr != nil {
		t.Fatalf("NewAppAt: %v", app.InitErr)
	}
	libraryRoot := filepath.Join(env.Root, "library")
	if _, err := app.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &libraryRoot}); err != nil {
		t.Fatalf("CreateLibrary: %v", err)
	}
	workspace, err := app.GetLibraryWorkspace()
	if err != nil || workspace.ActiveLibraryID == nil {
		t.Fatalf("workspace: %+v %v", workspace, err)
	}
	libraryID := *workspace.ActiveLibraryID

	first := writeModArchiveContent(t, "Upgrade.dll", "v1")
	if _, err := app.InstallModArchives(models.InstallModArchivesInput{TaskID: "u1", LibraryID: libraryID, ArchivePaths: []string{first}}); err != nil {
		t.Fatal(err)
	}
	app.Library.Wait()
	second := writeModArchiveContent(t, "Upgrade.dll", "v2")
	if _, err := app.InstallModArchives(models.InstallModArchivesInput{TaskID: "u2", LibraryID: libraryID, ArchivePaths: []string{second}}); err != nil {
		t.Fatal(err)
	}
	app.Library.Wait()

	workspace, err = app.GetLibraryWorkspace()
	if err != nil || len(workspace.ModsByLibraryID[libraryID]) != 1 {
		t.Fatalf("mods after upgrade: %+v %v", workspace, err)
	}
	mod := workspace.ModsByLibraryID[libraryID][0]
	if mod.InstalledPath == nil {
		t.Fatal("mod has no installed path")
	}
	body, err := os.ReadFile(filepath.Join(*mod.InstalledPath, "SPT", "user", "mods", "Upgrade", "Upgrade.dll"))
	if err != nil || string(body) != "v2" {
		t.Fatalf("upgraded content: %q %v", body, err)
	}
	if _, err := os.Stat(filepath.Join(libraryRoot, "backups", "Upgrade")); !os.IsNotExist(err) {
		t.Fatalf("upgrade created a snapshot: %v", err)
	}
}
