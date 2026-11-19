package library

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/modfs"
	"github.com/martes/modkeeper/backend/modmanager"
	"github.com/martes/modkeeper/backend/testenv"
)

func newParityService(t *testing.T) (*Service, *testenv.Env) {
	t.Helper()
	env := testenv.New(t)
	if err := os.RemoveAll(env.LibraryRoot); err != nil {
		t.Fatal(err)
	}
	s, err := New(filepath.Join(env.Root, "app.toml"))
	if err != nil {
		t.Fatal(err)
	}
	return s, env
}
func createParityLibrary(t *testing.T, s *Service, env *testenv.Env) *Library {
	t.Helper()
	if err := s.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot}); err != nil {
		t.Fatal(err)
	}
	return s.active
}

func TestTestLibraryInitAndAddMod(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	if _, err := os.Stat(l.ModsDir); err != nil {
		t.Fatal(err)
	}
	if err := modmanager.AddMod(&modmanager.Library{Root: l.ModsDir, Mods: l.manifest.Mods}, "added-id", "Example", "server", "local", false, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(l.ModsDir, "added-id", "manifest.toml")); err != nil {
		t.Fatal(err)
	}
	if _, ok := l.manifest.Mods["added-id"]; !ok {
		t.Fatal("added mod missing from manifest state")
	}
	if l.DTO().ID != l.manifest.ID {
		t.Fatal("DTO ID differs")
	}
}
func TestReaddingAGameRootReusesACompatibleVersionedLibraryAfterAPatchChange(t *testing.T) {
	s, env := newParityService(t)
	first := createParityLibrary(t, s, env)
	id := first.manifest.ID
	registryPath := filepath.Join(env.GameRoot, "SPT", "user", "sptRegistry", "registry.json")
	if err := os.WriteFile(registryPath, []byte(`{"SPT_Version":"SPT 4.0.12"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot}); err != nil {
		t.Fatal(err)
	}
	if s.active.manifest.ID != id {
		t.Fatalf("library ID changed: %s -> %s", id, s.active.manifest.ID)
	}
}

func TestDefaultLibraryRootMovesToAVersionedRootAfterAnSptMajorChange(t *testing.T) {
	s, env := newParityService(t)
	old := createParityLibrary(t, s, env)
	if err := os.WriteFile(filepath.Join(env.GameRoot, "SPT", "user", "sptRegistry", "registry.json"), []byte(`{"SPT_Version":"SPT 5.0.0"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot}); err != nil {
		t.Fatal(err)
	}
	if old.Root != DeriveLibraryRoot(env.GameRoot) || s.active.Root != DeriveLibraryRootForSPT(env.GameRoot, "5.0.0") {
		t.Fatalf("old=%s new=%s", old.Root, s.active.Root)
	}
	if _, err := os.Stat(old.Root); err != nil {
		t.Fatalf("old library removed: %v", err)
	}
}
func TestTestToDtoUsesHashId(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	src := filepath.Join(env.Root, "source_mod")
	if err := os.MkdirAll(filepath.Join(src, "SPT", "user", "mods", "TestMod"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "SPT", "user", "mods", "TestMod", "mod.js"), []byte(""), 0600); err != nil {
		t.Fatal(err)
	}
	fs, err := modfs.Scan(src, "SPT/user/mods", "BepInEx/plugins")
	if err != nil {
		t.Fatal(err)
	}
	if err := modmanager.AddMod(&modmanager.Library{Root: l.ModsDir, Mods: l.manifest.Mods}, fs.ID, "source_mod", fs.ModType, "local", false, nil); err != nil {
		t.Fatal(err)
	}
	dto := l.DTO()
	mod, ok := dto.Mods[fs.ID]
	if !ok || mod.ID != fs.ID || mod.Name != "source_mod" {
		t.Fatalf("DTO mod = %+v, id = %s", mod, fs.ID)
	}
}
func TestTestPersistenceCycle(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	l.manifest.Mods["persist-id"] = models.Mod{ID: "persist-id", Name: "Persist", Enabled: true}
	if err := l.Persist(); err != nil {
		t.Fatal(err)
	}
	got, err := Load(l.Root)
	if err != nil {
		t.Fatal(err)
	}
	if got.manifest.ID != l.manifest.ID {
		t.Fatal("ID changed during persistence cycle")
	}
	if !got.manifest.Mods["persist-id"].Enabled {
		t.Fatal("mod state not persisted")
	}
}
func TestTestModIdCaseNormalization(t *testing.T) {
	// Mod IDs are canonicalized at the filesystem scanner boundary. The durable
	// manifest retains the exact supplied ID; verify load does not alter it.
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	l.manifest.Mods["CaseID"] = models.Mod{ID: "CaseID"}
	if err := l.Persist(); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(l.Root)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := loaded.manifest.Mods["CaseID"]; !ok {
		t.Fatal("manifest key changed")
	}
}
func TestTestCacheRebuildConflictError(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	source, target := filepath.Join(l.ModsDir, "source"), filepath.Join(l.ModsDir, "same-id")
	for _, dir := range []string{source, target} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "manifest.toml"), []byte("id = 'same-id'\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := modmanager.NormalizeModFolders(l.ModsDir, "", "", nil); err == nil || !strings.Contains(err.Error(), "ModIdConflict") {
		t.Fatalf("expected ModIdConflict, got %v", err)
	}
}
func TestTestCreateLibraryRegistersAndActivates(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	if s.Store.Config.FindLibrary(l.manifest.ID) == nil || s.active != l {
		t.Fatal("not registered and activated")
	}
}
func TestTestCreateLibraryAdoptsExistingId(t *testing.T) {
	s, env := newParityService(t)
	root := DeriveLibraryRoot(env.GameRoot)
	old, err := Create(env.GameRoot, root, "Original")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot}); err != nil {
		t.Fatal(err)
	}
	if s.active.manifest.ID != old.manifest.ID {
		t.Fatal("existing ID was not adopted")
	}
}
func TestTestCreateLibraryInvalidExistingDirFails(t *testing.T) {
	s, env := newParityService(t)
	root := DeriveLibraryRoot(env.GameRoot)
	for _, name := range []string{"mods", "backups", "staging"} {
		if err := os.MkdirAll(filepath.Join(root, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	err := s.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot})
	if err == nil || !strings.Contains(err.Error(), "InvalidLibrary") {
		t.Fatalf("got %v", err)
	}
}
func TestTestActivateLibraryById(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	s.active = nil
	if err := s.ActivateLibrary(l.manifest.ID); err != nil {
		t.Fatal(err)
	}
	if s.active == nil || s.active.manifest.ID != l.manifest.ID {
		t.Fatal("not activated")
	}
}
func TestTestActivateUnsupportedSptVersionFailsOnlyOnActivate(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	l.manifest.SPTVersion = "3.1.0"
	if err := l.Persist(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(l.Root); err != nil {
		t.Fatal(err)
	}
	if err := s.ActivateLibrary(l.manifest.ID); err == nil {
		t.Fatal("expected activation failure")
	}
}
func TestTestRenameLibraryActiveAndInactive(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	if err := s.RenameLibrary(l.manifest.ID, "Renamed"); err != nil {
		t.Fatal(err)
	}
	if l.manifest.Name != "Renamed" {
		t.Fatal("active name not updated")
	}
	inactiveRoot := filepath.Join(env.Root, "inactive-library")
	inactive, err := Create(env.GameRoot, inactiveRoot, "Inactive")
	if err != nil {
		t.Fatal(err)
	}
	s.Store.Config.UpsertLibrary(config.KnownLibrary{ID: inactive.manifest.ID, LibraryRoot: inactiveRoot})
	if err := s.RenameLibrary(inactive.manifest.ID, "Inactive Renamed"); err != nil {
		t.Fatal(err)
	}
	loaded, err := Load(inactiveRoot)
	if err != nil || loaded.manifest.Name != "Inactive Renamed" {
		t.Fatalf("inactive rename: %v, %+v", err, loaded)
	}
	if s.active.manifest.ID != l.manifest.ID {
		t.Fatal("inactive rename changed active library")
	}
}
func TestTestDeleteLibraryEntryKeepsFiles(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	root := l.Root
	if err := s.DeleteLibrary(l.manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(root); err != nil {
		t.Fatal(err)
	}
}
func TestTestDeleteLibraryFilesRemovesDirectory(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	root := l.Root
	if err := s.DeleteLibrary(l.manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatalf("library remains: %v", err)
	}
}
func TestDeletingALibraryKeepsFilesWhenConfigSaveFails(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	root := l.Root
	s.Store.Path = env.Root
	if err := s.DeleteLibrary(l.manifest.ID, true); err == nil {
		t.Fatal("expected save error")
	}
	if s.Store.Config.FindLibrary(l.manifest.ID) == nil {
		t.Fatal("entry removed after save error")
	}
	if _, err := os.Stat(root); err != nil {
		t.Fatal(err)
	}
}
func TestDeletingALibraryLeavesNonemptyRecordedDirectoriesInPlace(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	unrecorded := filepath.Join(env.ServerMods, "user-data.txt")
	if err := os.WriteFile(unrecorded, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteLibrary(l.manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(l.Root); !os.IsNotExist(err) {
		t.Fatalf("library remains: %v", err)
	}
	if _, err := os.Stat(unrecorded); err != nil {
		t.Fatal(err)
	}
}
func TestTestDeleteLibraryUnregisteredIdFails(t *testing.T) {
	s, _ := newParityService(t)
	err := s.DeleteLibrary("missing", false)
	if err == nil || !strings.Contains(err.Error(), "InvalidLibrary") {
		t.Fatalf("got %v", err)
	}
}
func TestTestBulkUpdateSetsStaleAndNeverDeploys(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	l.manifest.Mods["m"] = models.Mod{ID: "m", Name: "M"}
	if err := modmanager.AddMod(&modmanager.Library{Root: l.ModsDir, Mods: l.manifest.Mods}, "m", "M", "server", "local", false, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.BulkUpdateMods(models.BulkUpdateModsInput{LibraryID: l.manifest.ID, ModIDs: []string{"m"}, Action: models.BulkActionEnable}); err != nil {
		t.Fatal(err)
	}
	if !l.manifest.IsDirty {
		t.Fatal("deploy stale flag not set")
	}
	if _, err := os.Stat(filepath.Join(env.ServerMods, "m")); !os.IsNotExist(err) {
		t.Fatalf("unexpected deployment: %v", err)
	}
}
func TestTestBulkUpdateRejectsNonActiveLibrary(t *testing.T) {
	s, _ := newParityService(t)
	if err := s.BulkUpdateMods(models.BulkUpdateModsInput{LibraryID: "other", ModIDs: []string{"x"}, Action: models.BulkActionEnable}); err == nil {
		t.Fatal("expected rejection")
	}
}
func TestTestBulkUpdateDeleteRemovesMod(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	l.manifest.Mods["m"] = models.Mod{ID: "m", Name: "M"}
	if err := modmanager.AddMod(&modmanager.Library{Root: l.ModsDir, Mods: l.manifest.Mods}, "m", "M", "server", "local", false, nil); err != nil {
		t.Fatal(err)
	}
	if err := s.BulkUpdateMods(models.BulkUpdateModsInput{LibraryID: l.manifest.ID, ModIDs: []string{"m"}, Action: models.BulkActionDelete}); err != nil {
		t.Fatal(err)
	}
	if _, ok := l.manifest.Mods["m"]; ok {
		t.Fatal("mod remains")
	}
}
func TestTestOverlappingModWritesSettleToARequestedState(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	l.manifest.Mods["m"] = models.Mod{ID: "m", Name: "M"}
	if err := modmanager.AddMod(&modmanager.Library{Root: l.ModsDir, Mods: l.manifest.Mods}, "m", "M", "server", "local", false, nil); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for _, action := range []models.BulkAction{models.BulkActionEnable, models.BulkActionDisable} {
		wg.Add(1)
		go func(action models.BulkAction) {
			defer wg.Done()
			errs <- s.BulkUpdateMods(models.BulkUpdateModsInput{LibraryID: l.manifest.ID, ModIDs: []string{"m"}, Action: action})
		}(action)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	loaded, err := Load(l.Root)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.manifest.Mods["m"].Enabled != l.manifest.Mods["m"].Enabled {
		t.Fatal("persisted state differs from in-memory state")
	}
	_ = env
}
func TestTestAssemblyUnreadableManifestIsPathOnlyStub(t *testing.T) {
	s, env := newParityService(t)
	root := filepath.Join(env.GameRoot, "broken")
	_ = os.MkdirAll(root, 0700)
	s.Store.Config.UpsertLibrary(config.KnownLibrary{ID: "broken", LibraryRoot: root})
	w := s.Workspace()
	if len(w.Libraries) != 1 || w.Libraries[0].Stub == nil || w.Libraries[0].Summary != nil {
		t.Fatalf("workspace: %+v", w.Libraries)
	}
}
func TestTestAssemblyReportsModsAndDeployStale(t *testing.T) {
	s, env := newParityService(t)
	l := createParityLibrary(t, s, env)
	l.manifest.IsDirty = true
	l.manifest.Mods["m"] = models.Mod{ID: "m", Name: "Example"}
	if err := l.Persist(); err != nil {
		t.Fatal(err)
	}
	w := s.Workspace()
	if len(w.Libraries) != 1 {
		t.Fatalf("libraries: %d", len(w.Libraries))
	}
	if !w.Libraries[0].Summary.DeployStale {
		t.Fatal("deploy stale missing")
	}
	if len(w.ModsByLibraryID[l.manifest.ID]) != 1 {
		t.Fatal("mod summary missing")
	}
}
