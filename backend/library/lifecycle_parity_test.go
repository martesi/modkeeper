package library

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

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

func TestActivateInactiveLibraryRecoversInterruptedInstall(t *testing.T) {
	s, env := newParityService(t)
	active := createParityLibrary(t, s, env)
	inactiveRoot := filepath.Join(env.Root, "inactive-recovery-library")
	inactive, err := Create(env.GameRoot, inactiveRoot, "Inactive")
	if err != nil {
		t.Fatal(err)
	}
	s.Store.Config.UpsertLibrary(config.KnownLibrary{ID: inactive.manifest.ID, LibraryRoot: inactive.Root})
	if err := s.Store.Save(); err != nil {
		t.Fatal(err)
	}

	oldMod := models.Mod{ID: "RecoverOnActivate", Name: "old", Source: models.ModSourceLocal}
	newMod := models.Mod{ID: oldMod.ID, Name: "new", Source: models.ModSourceLocal}
	destination := filepath.Join(inactive.ModsDir, oldMod.ID)
	snapshot := installSnapshotPath(inactive, oldMod.ID)
	for path, content := range map[string]string{
		filepath.Join(destination, "version"): "new",
		filepath.Join(snapshot, "version"):    "old",
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	inactive.manifest.Mods[oldMod.ID] = newMod
	if err := inactive.Persist(); err != nil {
		t.Fatal(err)
	}
	if err := writeInstallTransaction(installMarkerPath(inactive, oldMod.ID), installTransaction{
		Version: 1, ID: oldMod.ID, Phase: installPrepared, HadOld: true, OldMod: &oldMod, NewMod: newMod,
	}); err != nil {
		t.Fatal(err)
	}

	if err := s.ActivateLibrary(active.manifest.ID); err != nil {
		t.Fatal(err)
	}
	if s.active.manifest.ID != active.manifest.ID {
		t.Fatal("expected library A to remain active before switching")
	}
	if err := s.ActivateLibrary(inactive.manifest.ID); err != nil {
		t.Fatal(err)
	}
	if s.active.manifest.ID != inactive.manifest.ID {
		t.Fatal("inactive library was not activated")
	}
	if body, err := os.ReadFile(filepath.Join(destination, "version")); err != nil || string(body) != "old" {
		t.Fatalf("activation recovery content=%q err=%v", body, err)
	}
	if s.active.manifest.Mods[oldMod.ID].Name != "old" {
		t.Fatalf("activation recovery manifest=%+v", s.active.manifest.Mods[oldMod.ID])
	}
	for _, artifact := range []string{
		installPreparedMarkerPath(inactive, oldMod.ID),
		installCommittedMarkerPath(inactive, oldMod.ID),
		snapshot,
	} {
		if _, err := os.Stat(artifact); !os.IsNotExist(err) {
			t.Fatalf("activation left recovery artifact %q: %v", artifact, err)
		}
	}
}

func TestActivationIsBusyWhileInstallHasPreparedMarker(t *testing.T) {
	s, env := newParityService(t)
	active := createParityLibrary(t, s, env)
	inactiveRoot := filepath.Join(env.Root, "activation-busy-library")
	inactive, err := Create(env.GameRoot, inactiveRoot, "Inactive")
	if err != nil {
		t.Fatal(err)
	}
	s.Store.Config.UpsertLibrary(config.KnownLibrary{ID: inactive.manifest.ID, LibraryRoot: inactive.Root})
	if err := s.Store.Save(); err != nil {
		t.Fatal(err)
	}
	oldMod := models.Mod{ID: "KeepExisting", Name: "keep", Source: models.ModSourceLocal}
	inactive.manifest.Mods[oldMod.ID] = oldMod
	if err := inactive.Persist(); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(inactive.ModsDir, oldMod.ID), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(inactive.ModsDir, oldMod.ID, "owned.txt"), []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}

	markerReady, resume := make(chan struct{}), make(chan struct{})
	var resumeOnce sync.Once
	resumeInstall := func() { resumeOnce.Do(func() { close(resume) }) }
	defer resumeInstall()
	s.installTransactionHook = func(boundary string) {
		if boundary == "after-prepared-marker" {
			close(markerReady)
			<-resume
		}
	}
	terminal := make(chan models.TaskProgressEvent, 32)
	s.SetEventSenders(func(event models.TaskProgressEvent) error {
		if event.Kind == models.TaskProgressCompleted {
			terminal <- event
		}
		return nil
	}, nil)
	archive := writeInstallTestArchive(t, "ConcurrentInstall", "installed")
	if _, err := s.InstallModArchives(models.InstallModArchivesInput{
		TaskID: "activation-in-flight", LibraryID: active.manifest.ID, ArchivePaths: []string{archive},
	}, nil); err != nil {
		t.Fatal(err)
	}
	select {
	case <-markerReady:
	case <-time.After(10 * time.Second):
		t.Fatal("install did not pause after writing its prepared marker")
	}

	for _, id := range []string{active.manifest.ID, inactive.manifest.ID} {
		err := s.ActivateLibrary(id)
		var wireError *models.Error
		if !errors.As(err, &wireError) || wireError.Code != models.LibraryBusy {
			t.Fatalf("activation of %s error=%v; want explicit LibraryBusy", id, err)
		}
	}
	if s.active.manifest.ID != active.manifest.ID {
		t.Fatal("busy activation changed the active library")
	}
	var pendingID string
	for id := range active.manifest.Mods {
		pendingID = id
	}
	if pendingID == "" {
		entries, err := os.ReadDir(active.BackupsDir)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			if strings.HasSuffix(entry.Name(), ".install.prepared") {
				pendingID = strings.TrimSuffix(entry.Name(), ".install.prepared")
			}
		}
	}
	if pendingID == "" {
		t.Fatal("prepared marker was removed by activation")
	}
	if _, err := os.Stat(installPreparedMarkerPath(active, pendingID)); err != nil {
		t.Fatalf("paused install marker disappeared: %v", err)
	}
	if body, err := os.ReadFile(filepath.Join(inactive.ModsDir, oldMod.ID, "owned.txt")); err != nil || string(body) != "keep" {
		t.Fatalf("inactive library file changed: %q %v", body, err)
	}
	reloadedInactive, err := Load(inactive.Root)
	if err != nil {
		t.Fatal(err)
	}
	if reloadedInactive.manifest.Mods[oldMod.ID].Name != "keep" {
		t.Fatalf("inactive manifest changed: %+v", reloadedInactive.manifest.Mods)
	}

	resumeInstall()
	s.Wait()
	select {
	case event := <-terminal:
		if event.Stage != models.TaskStageTaskCompleted || event.Log == nil || event.Log.Code != "task_completed" {
			t.Fatalf("install terminal event=%+v; want successful completion", event)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("install task did not report completion")
	}
	s.installTransactionHook = nil
	if len(active.manifest.Mods) != 1 {
		t.Fatalf("active library manifest mods=%+v", active.manifest.Mods)
	}
	var installedID string
	for id := range active.manifest.Mods {
		installedID = id
	}
	assertFileContents(t, filepath.Join(active.ModsDir, installedID, "SPT", "user", "mods", "ConcurrentInstall", "version"), "installed")
	assertInstallArtifactsRemoved(t, active, installedID)
	if _, err := os.Stat(archive); err != nil {
		t.Fatalf("source archive was removed: %s: %v", archive, err)
	}
	reloadedInactive, err = Load(inactive.Root)
	if err != nil {
		t.Fatal(err)
	}
	if reloadedInactive.manifest.Mods[oldMod.ID] != oldMod {
		t.Fatalf("inactive library metadata changed after install: %+v", reloadedInactive.manifest.Mods)
	}
	assertFileContents(t, filepath.Join(reloadedInactive.ModsDir, oldMod.ID, "owned.txt"), "keep")
	if s.active.manifest.ID != active.manifest.ID {
		t.Fatal("active library changed after install completion")
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
	w := mustWorkspace(t, s)
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
	w := mustWorkspace(t, s)
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
