package library

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/registry"
	"github.com/martes/modkeeper/backend/store"
)

func mustWorkspace(t *testing.T, s *Service) *models.LibraryWorkspace {
	t.Helper()
	return s.Workspace()
}

func findWorkspaceSummary(t *testing.T, w *models.LibraryWorkspace, id string) *models.LibrarySummary {
	t.Helper()
	for _, entry := range w.Libraries {
		if entry.Summary != nil && entry.Summary.ID == id {
			return entry.Summary
		}
	}
	t.Fatalf("library %q is not a summary: %+v", id, w.Libraries)
	return nil
}

func findWorkspaceMod(t *testing.T, w *models.LibraryWorkspace, libraryID, modID string) *models.ModSummary {
	t.Helper()
	for i := range w.ModsByLibraryID[libraryID] {
		if w.ModsByLibraryID[libraryID][i].ID == modID {
			return &w.ModsByLibraryID[libraryID][i]
		}
	}
	t.Fatalf("mod %q missing from library %q: %+v", modID, libraryID, w.ModsByLibraryID[libraryID])
	return nil
}

// addInactiveLibrary registers a library without activating it, so workspace
// assembly reads its files instead of the in-memory active instance.
func addInactiveLibrary(t *testing.T, s *Service, gameRoot, root string) *Library {
	t.Helper()
	l, err := Create(gameRoot, root, filepath.Base(root))
	if err != nil {
		t.Fatal(err)
	}
	s.Store.Config.UpsertLibrary(config.KnownLibrary{ID: l.manifest.ID, LibraryRoot: root})
	if err := s.Store.Save(); err != nil {
		t.Fatal(err)
	}
	return l
}

func rewriteTOML(t *testing.T, path string, mutate func(map[string]any)) {
	t.Helper()
	var raw map[string]any
	if _, err := toml.DecodeFile(path, &raw); err != nil {
		t.Fatal(err)
	}
	mutate(raw)
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := toml.NewEncoder(f).Encode(raw); err != nil {
		_ = f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
}

func assertStub(t *testing.T, w *models.LibraryWorkspace, path string) {
	t.Helper()
	if len(w.Libraries) != 1 || w.Libraries[0].Stub == nil || w.Libraries[0].Stub.Path != path {
		t.Fatalf("library entry = %+v; want a stub for %s", w.Libraries, path)
	}
}

// Rust fills the mod summary from the manifest plus the installed tree
// (global_service.rs assemble_workspace). The workspace must carry that data
// and keep updatedAt stable while the files are untouched.
func TestTestWorkspaceModSummaryMirrorsManifestAndFileMetadata(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	libraryID := l.manifest.ID

	installed := filepath.Join(l.ModsDir, "mod-a")
	if err := os.MkdirAll(installed, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installed, "content.dll"), []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	installedTime := time.Date(2025, 3, 4, 5, 6, 7, 0, time.UTC)
	if err := os.Chtimes(installed, installedTime, installedTime); err != nil {
		t.Fatal(err)
	}
	manifestTime := time.Date(2025, 1, 2, 3, 4, 5, 0, time.UTC)

	version, guid, cached := "1.2.3", "forge-guid-1", "2025-01-01T00:00:00Z"
	installedAt := "2024-12-31T00:00:00Z"
	forgeID, forgeVersionID := uint64(42), uint64(7)
	kind := models.ForgeKindMod
	source := models.ModSourceForge
	l.manifest.Mods["mod-a"] = models.Mod{
		ID: "mod-a", Enabled: true, Type: models.ModTypeBoth, Name: "Alpha",
		InstalledAt: &installedAt, Version: &version, ForgeID: &forgeID,
		ForgeGUID: &guid, Source: source, ForgeKind: &kind,
		ForgeVersionID: &forgeVersionID, ForgeMetaCachedAt: &cached,
	}
	// A second mod predates installedAt recording; its installed tree supplies it.
	fallbackInstalled := filepath.Join(l.ModsDir, "mod-b")
	if err := os.MkdirAll(fallbackInstalled, 0700); err != nil {
		t.Fatal(err)
	}
	l.manifest.Mods["mod-b"] = models.Mod{ID: "mod-b", Name: "Beta", Type: models.ModTypeClient, Source: models.ModSourceLocal}
	if err := l.Persist(); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(filepath.Join(l.Root, "manifest.toml"), manifestTime, manifestTime); err != nil {
		t.Fatal(err)
	}

	workspace := mustWorkspace(t, s)
	summary := findWorkspaceSummary(t, workspace, libraryID)
	if summary.UpdatedAt != manifestTime.Format(time.RFC3339) {
		t.Fatalf("library updatedAt = %q; want manifest mtime %q", summary.UpdatedAt, manifestTime.Format(time.RFC3339))
	}

	mod := findWorkspaceMod(t, workspace, libraryID, "mod-a")
	if mod.Version == nil || *mod.Version != version {
		t.Fatalf("version = %v; want %q", mod.Version, version)
	}
	if mod.ForgeID == nil || *mod.ForgeID != forgeID {
		t.Fatalf("forgeId = %v; want %d", mod.ForgeID, forgeID)
	}
	if mod.ForgeGUID == nil || *mod.ForgeGUID != guid {
		t.Fatalf("forgeGuid = %v; want %q", mod.ForgeGUID, guid)
	}
	if mod.Source == nil || *mod.Source != models.ModSourceForge {
		t.Fatalf("source = %v; want forge", mod.Source)
	}
	if mod.ForgeKind == nil || *mod.ForgeKind != models.ForgeKindMod {
		t.Fatalf("forgeKind = %v; want mod", mod.ForgeKind)
	}
	if mod.ForgeVersionID == nil || *mod.ForgeVersionID != forgeVersionID {
		t.Fatalf("forgeVersionId = %v; want %d", mod.ForgeVersionID, forgeVersionID)
	}
	if mod.ForgeMetaCachedAt == nil || *mod.ForgeMetaCachedAt != cached {
		t.Fatalf("forgeMetaCachedAt = %v; want %q", mod.ForgeMetaCachedAt, cached)
	}
	if mod.InstalledAt == nil || *mod.InstalledAt != installedAt {
		t.Fatalf("installedAt = %v; want manifest value %q", mod.InstalledAt, installedAt)
	}
	if want := installedTime.Format(time.RFC3339); mod.UpdatedAt != want {
		t.Fatalf("updatedAt = %q; want installed-tree mtime %q", mod.UpdatedAt, want)
	}

	fallback := findWorkspaceMod(t, workspace, libraryID, "mod-b")
	if fallback.InstalledAt == nil || *fallback.InstalledAt == "" {
		t.Fatal("installedAt fallback from the installed tree is missing")
	}
	if fallback.Version != nil || fallback.ForgeID != nil {
		t.Fatalf("local mod gained forge identity: %+v", fallback)
	}

	// The wire contract, not just the Go structs, carries these fields.
	encoded, err := json.Marshal(workspace)
	if err != nil {
		t.Fatal(err)
	}
	var wire struct {
		Libraries       []map[string]any            `json:"libraries"`
		ModsByLibraryID map[string][]map[string]any `json:"modsByLibraryId"`
	}
	if err := json.Unmarshal(encoded, &wire); err != nil {
		t.Fatal(err)
	}
	cache, ok := wire.Libraries[0]["cacheStatus"].(map[string]any)
	if !ok {
		t.Fatalf("cacheStatus is not a JSON object: %s", encoded)
	}
	if _, ok := cache["lastRebuiltAt"]; !ok {
		t.Fatalf("cacheStatus.lastRebuiltAt missing from wire: %s", encoded)
	}
	if _, ok := wire.Libraries[0]["updatedAt"]; !ok {
		t.Fatalf("updatedAt missing from wire library summary: %s", encoded)
	}
	wireMod := wire.ModsByLibraryID[libraryID][0]
	for _, field := range []string{"installedAt", "forgeVersionId", "forgeGuid", "version", "libraryId", "isEnabled", "type"} {
		if _, ok := wireMod[field]; !ok {
			t.Fatalf("%s missing from wire mod summary: %s", field, encoded)
		}
	}

	// A poll with unchanged files must not churn timestamps.
	second := mustWorkspace(t, s)
	if !reflect.DeepEqual(workspace.ModsByLibraryID[libraryID], second.ModsByLibraryID[libraryID]) {
		t.Fatalf("workspace mod summaries changed without a change:\nfirst: %+v\nsecond: %+v",
			workspace.ModsByLibraryID[libraryID], second.ModsByLibraryID[libraryID])
	}
	if findWorkspaceSummary(t, second, libraryID).UpdatedAt != summary.UpdatedAt {
		t.Fatal("library updatedAt changed without a change")
	}
}

func TestTestWorkspaceCacheStatusMirrorsCacheFile(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)

	activeCacheTime := time.Date(2025, 5, 6, 7, 8, 9, 0, time.UTC)
	if err := os.Chtimes(filepath.Join(l.Root, "cache.toml"), activeCacheTime, activeCacheTime); err != nil {
		t.Fatal(err)
	}
	active := findWorkspaceSummary(t, mustWorkspace(t, s), l.manifest.ID)
	if active.CacheStatus.State != models.CacheStateReady {
		t.Fatalf("active cache state = %q; want ready", active.CacheStatus.State)
	}
	if active.CacheStatus.LastRebuiltAt == nil || *active.CacheStatus.LastRebuiltAt != activeCacheTime.Format(time.RFC3339) {
		t.Fatalf("active lastRebuiltAt = %v; want cache mtime %q", active.CacheStatus.LastRebuiltAt, activeCacheTime.Format(time.RFC3339))
	}

	other := addInactiveLibrary(t, s, env.GameRoot, filepath.Join(env.Root, "other-library"))
	otherCacheTime := time.Date(2025, 6, 7, 8, 9, 10, 0, time.UTC)
	if err := os.Chtimes(filepath.Join(other.Root, "cache.toml"), otherCacheTime, otherCacheTime); err != nil {
		t.Fatal(err)
	}
	valid := findWorkspaceSummary(t, mustWorkspace(t, s), other.manifest.ID)
	if valid.CacheStatus.State != models.CacheStateReady ||
		valid.CacheStatus.LastRebuiltAt == nil ||
		*valid.CacheStatus.LastRebuiltAt != otherCacheTime.Format(time.RFC3339) {
		t.Fatalf("inactive cache status = %+v; want ready at %q", valid.CacheStatus, otherCacheTime.Format(time.RFC3339))
	}

	if err := os.WriteFile(filepath.Join(other.Root, "cache.toml"), []byte("mods = ["), 0600); err != nil {
		t.Fatal(err)
	}
	failed := findWorkspaceSummary(t, mustWorkspace(t, s), other.manifest.ID)
	if failed.CacheStatus.State != models.CacheStateFailed {
		t.Fatalf("corrupt cache state = %q; want failed", failed.CacheStatus.State)
	}
	if failed.CacheStatus.Message == nil || *failed.CacheStatus.Message == "" {
		t.Fatal("corrupt cache status is missing its message")
	}
	if failed.CacheStatus.LastRebuiltAt != nil {
		t.Fatalf("corrupt cache lastRebuiltAt = %q; want nil", *failed.CacheStatus.LastRebuiltAt)
	}

	// The active library's in-memory state wins over a broken cache file.
	if err := os.WriteFile(filepath.Join(l.Root, "cache.toml"), []byte("mods = ["), 0600); err != nil {
		t.Fatal(err)
	}
	stillActive := findWorkspaceSummary(t, mustWorkspace(t, s), l.manifest.ID)
	if stillActive.CacheStatus.State != models.CacheStateReady {
		t.Fatalf("active corrupt cache state = %q; want ready", stillActive.CacheStatus.State)
	}
}

func TestTestWorkspaceCacheStatusRejectsCacheRustCannotRead(t *testing.T) {
	cases := []struct {
		name    string
		content string
	}{
		{name: "empty", content: ""},
		{name: "mod-entry-is-not-a-table", content: "mods = { a = 5 }\n"},
		{name: "mod-type-uppercase", content: "mods = { a = { id = 'a', modType = 'SERVER', files = [], executables = [] } }\n"},
		{name: "mod-entry-missing-fields", content: "mods = { a = { id = 'a' } }\n"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, env := newParityService(t)
			l := addInactiveLibrary(t, s, env.GameRoot, filepath.Join(env.Root, "cache-library"))
			if err := os.WriteFile(filepath.Join(l.Root, "cache.toml"), []byte(tc.content), 0600); err != nil {
				t.Fatal(err)
			}
			summary := findWorkspaceSummary(t, mustWorkspace(t, s), l.manifest.ID)
			if summary.CacheStatus.State != models.CacheStateFailed {
				t.Fatalf("cache state = %q; want failed for %q", summary.CacheStatus.State, tc.content)
			}
			if summary.CacheStatus.Message == nil || *summary.CacheStatus.Message == "" {
				t.Fatal("failed cache status is missing its message")
			}
			if summary.CacheStatus.LastRebuiltAt != nil {
				t.Fatalf("failed cache lastRebuiltAt = %q; want nil", *summary.CacheStatus.LastRebuiltAt)
			}
		})
	}
}

func TestTestWorkspaceStubsManifestWithoutIsDirty(t *testing.T) {
	s, env := newParityService(t)
	root := filepath.Join(env.Root, "strict-library")
	l := addInactiveLibrary(t, s, env.GameRoot, root)
	rewriteTOML(t, filepath.Join(root, "manifest.toml"), func(m map[string]any) {
		delete(m, "isDirty")
	})
	assertStub(t, mustWorkspace(t, s), l.Root)
}

func TestTestWorkspaceStubsModWithoutType(t *testing.T) {
	s, env := newParityService(t)
	root := filepath.Join(env.Root, "strict-mod-library")
	l := addInactiveLibrary(t, s, env.GameRoot, root)
	l.manifest.Mods["mod-a"] = models.Mod{ID: "mod-a", Name: "Alpha", Type: models.ModTypeServer, Source: models.ModSourceLocal}
	if err := l.Persist(); err != nil {
		t.Fatal(err)
	}
	rewriteTOML(t, filepath.Join(root, "manifest.toml"), func(m map[string]any) {
		mods, ok := m["mods"].(map[string]any)
		if !ok {
			t.Fatal("mods table missing from fixture")
		}
		mod, ok := mods["mod-a"].(map[string]any)
		if !ok {
			t.Fatal("mod-a missing from fixture")
		}
		delete(mod, "type")
	})
	assertStub(t, mustWorkspace(t, s), l.Root)
}

func TestTestLoadRejectsManifestWithoutRepoRoot(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	rewriteTOML(t, filepath.Join(l.Root, "manifest.toml"), func(m map[string]any) {
		delete(m, "repoRoot")
	})
	if _, err := Load(l.Root); err == nil ||
		!strings.Contains(err.Error(), "InvalidLibrary") ||
		!strings.Contains(err.Error(), "repoRoot") {
		t.Fatalf("Load error = %v; want InvalidLibrary naming repoRoot", err)
	}
}

func TestTestInactiveManifestWithoutRepoRootStaysStub(t *testing.T) {
	s, env := newParityService(t)
	active := createParityLibrary(t, s, env)
	root := filepath.Join(env.Root, "no-repo-root-library")
	inactive := addInactiveLibrary(t, s, env.GameRoot, root)
	rewriteTOML(t, filepath.Join(root, "manifest.toml"), func(m map[string]any) {
		delete(m, "repoRoot")
	})
	workspace := mustWorkspace(t, s)
	if len(workspace.Libraries) != 2 {
		t.Fatalf("libraries = %+v; want active summary and inactive stub", workspace.Libraries)
	}
	if workspace.Libraries[0].Summary == nil || workspace.Libraries[0].Summary.ID != active.manifest.ID {
		t.Fatalf("active entry = %+v; want a summary", workspace.Libraries[0])
	}
	if workspace.Libraries[1].Stub == nil || workspace.Libraries[1].Stub.Path != inactive.Root {
		t.Fatalf("inactive entry = %+v; want a stub", workspace.Libraries[1])
	}
}

func TestTestStartupLoadFailsWhenActiveManifestLacksRepoRoot(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	configPath := s.Store.Path
	rewriteTOML(t, filepath.Join(l.Root, "manifest.toml"), func(m map[string]any) {
		delete(m, "repoRoot")
	})

	restarted, err := New(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.Start(); err != nil {
		t.Fatal(err)
	}
	if err := restarted.WaitForInitialLoad(); err != nil {
		t.Fatal(err)
	}
	if restarted.Store.Config.AppState.ActiveLibraryID != nil {
		t.Fatalf("active library = %q; want cleared", *restarted.Store.Config.AppState.ActiveLibraryID)
	}
	persisted, err := store.LoadFrom(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.AppState.ActiveLibraryID != nil {
		t.Fatalf("persisted active library = %q; want cleared", *persisted.AppState.ActiveLibraryID)
	}
	assertStub(t, restarted.Workspace(), l.Root)
	if warning := restarted.TakeStartupWarning(); warning != nil {
		t.Fatalf("startup warning = %q; want none", *warning)
	}
}

func TestTestWorkspaceRejectsNonRustEnums(t *testing.T) {
	cases := []struct {
		name  string
		key   string
		value string
	}{
		{name: "mod-type-uppercase", key: "type", value: "SERVER"},
		{name: "mod-source-titlecase", key: "source", value: "Local"},
		{name: "forge-kind-uppercase", key: "forgeKind", value: "MOD"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, env := newParityService(t)
			root := filepath.Join(env.Root, "enum-library")
			l := addInactiveLibrary(t, s, env.GameRoot, root)
			kind := models.ForgeKindMod
			l.manifest.Mods["mod-a"] = models.Mod{
				ID: "mod-a", Name: "Alpha", Type: models.ModTypeServer,
				Source: models.ModSourceLocal, ForgeKind: &kind,
			}
			if err := l.Persist(); err != nil {
				t.Fatal(err)
			}
			rewriteTOML(t, filepath.Join(root, "manifest.toml"), func(m map[string]any) {
				mods := m["mods"].(map[string]any)
				mods["mod-a"].(map[string]any)[tc.key] = tc.value
			})
			assertStub(t, mustWorkspace(t, s), l.Root)
		})
	}
}

// Workspace assembly never consumes the startup warning; only the
// get_library_workspace command does.
func TestTestWorkspaceDoesNotConsumeStartupWarning(t *testing.T) {
	s, _ := newParityService(t)
	s.setWarning("repair the library")
	if warning := mustWorkspace(t, s).ConfigWarning; warning != nil {
		t.Fatalf("workspace warning = %q; assembly must not attach the warning", *warning)
	}
	if warning := mustWorkspace(t, s).ConfigWarning; warning != nil {
		t.Fatalf("second workspace warning = %q; assembly must not attach the warning", *warning)
	}
	first := s.TakeStartupWarning()
	if first == nil || *first != "repair the library" {
		t.Fatalf("take = %v; want the pending warning", first)
	}
	if second := s.TakeStartupWarning(); second != nil {
		t.Fatalf("second take = %q; want it consumed", *second)
	}
}

func TestTestWaitForInitialLoadReturnsStartupError(t *testing.T) {
	s, _ := newParityService(t)
	s.startupStarted = true
	timeoutMessage := fmt.Sprintf("Initial library load timed out after %s", registry.StartupLoadTimeout)
	s.Registry.FinishStartupLoad(errors.New(timeoutMessage))
	err := s.WaitForInitialLoad()
	var domain *models.Error
	if !errors.As(err, &domain) || domain.Code != models.AsyncRuntimeError || domain.Data != timeoutMessage {
		t.Fatalf("startup error = %v; want AsyncRuntimeError with the Rust message", err)
	}
}

func TestTestStartupLoadFailureClearsPersistedActiveLibrary(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	configPath := s.Store.Path
	if s.Store.Config.AppState.ActiveLibraryID == nil {
		t.Fatal("fixture did not persist an active library")
	}
	if err := os.Remove(filepath.Join(l.Root, "manifest.toml")); err != nil {
		t.Fatal(err)
	}

	restarted, err := New(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.Start(); err != nil {
		t.Fatal(err)
	}
	if err := restarted.Registry.WaitForStartupLoad(t.Context()); err != nil {
		t.Fatalf("startup load reported a task failure: %v", err)
	}
	if restarted.Store.Config.AppState.ActiveLibraryID != nil {
		t.Fatalf("in-memory active library = %q; want cleared", *restarted.Store.Config.AppState.ActiveLibraryID)
	}
	persisted, err := store.LoadFrom(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.AppState.ActiveLibraryID != nil {
		t.Fatalf("persisted active library = %q; want cleared", *persisted.AppState.ActiveLibraryID)
	}
	// A plain load failure is logged by Rust, not handed to the frontend.
	if warning := restarted.Workspace().ConfigWarning; warning != nil {
		t.Fatalf("first workspace warning = %q; want none", *warning)
	}
	if warning := restarted.TakeStartupWarning(); warning != nil {
		t.Fatalf("startup warning = %q; want none", *warning)
	}
}

func TestTestStartupLoadFailureSurfacesOnlyTheSaveFailure(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	configPath := s.Store.Path
	if err := os.Remove(filepath.Join(l.Root, "manifest.toml")); err != nil {
		t.Fatal(err)
	}
	restarted, err := New(configPath)
	if err != nil {
		t.Fatal(err)
	}
	// Renaming onto an existing directory makes the cleared-config save fail.
	blocked := filepath.Join(env.Root, "config-target")
	if err := os.MkdirAll(blocked, 0700); err != nil {
		t.Fatal(err)
	}
	restarted.Store.Path = blocked
	if err := restarted.Start(); err != nil {
		t.Fatal(err)
	}
	if err := restarted.Registry.WaitForStartupLoad(t.Context()); err != nil {
		t.Fatalf("startup load reported a task failure: %v", err)
	}
	if restarted.Store.Config.AppState.ActiveLibraryID != nil {
		t.Fatal("in-memory active library was not cleared")
	}
	warning := restarted.TakeStartupWarning()
	if warning == nil || !strings.Contains(*warning, "save config") {
		t.Fatalf("startup warning = %v; want the config save failure", warning)
	}
}
