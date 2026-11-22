package library

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/store"
)

func mustWorkspace(t *testing.T, s *Service) *models.LibraryWorkspace {
	t.Helper()
	workspace, err := s.Workspace()
	if err != nil {
		t.Fatal(err)
	}
	return workspace
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

	otherRoot := filepath.Join(env.Root, "other-library")
	other, err := Create(env.GameRoot, otherRoot, "Other")
	if err != nil {
		t.Fatal(err)
	}
	s.Store.Config.UpsertLibrary(config.KnownLibrary{ID: other.manifest.ID, LibraryRoot: otherRoot})
	if err := s.Store.Save(); err != nil {
		t.Fatal(err)
	}
	otherCacheTime := time.Date(2025, 6, 7, 8, 9, 10, 0, time.UTC)
	if err := os.Chtimes(filepath.Join(otherRoot, "cache.toml"), otherCacheTime, otherCacheTime); err != nil {
		t.Fatal(err)
	}
	valid := findWorkspaceSummary(t, mustWorkspace(t, s), other.manifest.ID)
	if valid.CacheStatus.State != models.CacheStateReady ||
		valid.CacheStatus.LastRebuiltAt == nil ||
		*valid.CacheStatus.LastRebuiltAt != otherCacheTime.Format(time.RFC3339) {
		t.Fatalf("inactive cache status = %+v; want ready at %q", valid.CacheStatus, otherCacheTime.Format(time.RFC3339))
	}

	if err := os.WriteFile(filepath.Join(otherRoot, "cache.toml"), []byte("mods = ["), 0600); err != nil {
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

func TestTestWorkspaceReturnsConfigWarningOnce(t *testing.T) {
	s, _ := newParityService(t)
	s.setWarning("repair the library")
	first := mustWorkspace(t, s)
	if first.ConfigWarning == nil || *first.ConfigWarning != "repair the library" {
		t.Fatalf("first configWarning = %v; want the pending warning", first.ConfigWarning)
	}
	second := mustWorkspace(t, s)
	if second.ConfigWarning != nil {
		t.Fatalf("second configWarning = %q; want it consumed", *second.ConfigWarning)
	}
}

func TestTestWorkspaceReturnsStartupLoadError(t *testing.T) {
	s, _ := newParityService(t)
	s.startupStarted = true
	s.Registry.FinishStartupLoad(errors.New("Initial library load timed out after 10s"))
	workspace, err := s.Workspace()
	if workspace != nil {
		t.Fatalf("workspace = %+v; want no synthetic workspace", workspace)
	}
	var domain *models.Error
	if !errors.As(err, &domain) || domain.Code != models.AsyncRuntimeError || domain.Data != "Initial library load timed out after 10s" {
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
}
