package library

import (
	"archive/zip"
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/testenv"
)

func TestCrashAfterInstallManifestPersistRollsBackFilesAndMetadata(t *testing.T) {
	if os.Getenv("MODKEEPER_INSTALL_COMMIT_HELPER") == "1" {
		return
	}
	env := testenv.New(t)
	root := filepath.Join(env.Root, "commit-crash-library")
	configPath := filepath.Join(env.Root, "commit-crash-config.toml")
	v1Archive := writeInstallTestArchive(t, "CrashMod", "v1")
	v2Archive := writeInstallTestArchive(t, "CrashMod", "v2")
	oldMetadata := filepath.Join(env.Root, "old-installed-at")

	killHelperAtBoundary(t, exec.Command(
		mustExecutable(t), "-test.run=^TestInstallCommitCrashHelper$",
	), map[string]string{
		"MODKEEPER_INSTALL_COMMIT_HELPER": "1",
		"MODKEEPER_INSTALL_COMMIT_GAME":   env.GameRoot,
		"MODKEEPER_INSTALL_COMMIT_ROOT":   root,
		"MODKEEPER_INSTALL_COMMIT_CONFIG": configPath,
		"MODKEEPER_INSTALL_COMMIT_V1":     v1Archive,
		"MODKEEPER_INSTALL_COMMIT_V2":     v2Archive,
		"MODKEEPER_INSTALL_COMMIT_OLD":    oldMetadata,
	}, "KILL_POINT_AFTER_MANIFEST_PERSIST")

	oldMetadataBytes, err := os.ReadFile(oldMetadata)
	if err != nil {
		t.Fatal(err)
	}
	var expectedOld struct {
		ID  string     `json:"id"`
		Mod models.Mod `json:"mod"`
	}
	if err := json.Unmarshal(oldMetadataBytes, &expectedOld); err != nil {
		t.Fatal(err)
	}
	l, err := Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := recoverInterruptedInstall(l); err != nil {
		t.Fatal(err)
	}
	assertFileContents(t, filepath.Join(l.ModsDir, expectedOld.ID, "SPT", "user", "mods", "CrashMod", "version"), "v1")
	reloaded, err := Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if got := reloaded.manifest.Mods[expectedOld.ID]; !reflect.DeepEqual(got, expectedOld.Mod) {
		t.Fatalf("second-load old metadata=%+v; want full old record=%+v", got, expectedOld.Mod)
	}
	assertInstallArtifactsRemoved(t, l, expectedOld.ID)
	for _, archive := range []string{v1Archive, v2Archive} {
		if _, err := os.Stat(archive); err != nil {
			t.Fatalf("source archive was removed: %s: %v", archive, err)
		}
	}
}

func TestCrashAfterFreshInstallReplacementRemovesFilesAndManifestEntry(t *testing.T) {
	if os.Getenv("MODKEEPER_FRESH_REPLACEMENT_HELPER") == "1" {
		return
	}
	env := testenv.New(t)
	root := filepath.Join(env.Root, "fresh-replacement-library")
	idPath := filepath.Join(env.Root, "fresh-replacement-id")
	archive := writeInstallTestArchive(t, "FreshCrash", "fresh")
	killHelperAtBoundary(t, exec.Command(
		mustExecutable(t), "-test.run=^TestFreshInstallReplacementCrashHelper$",
	), map[string]string{
		"MODKEEPER_FRESH_REPLACEMENT_HELPER":  "1",
		"MODKEEPER_FRESH_REPLACEMENT_GAME":    env.GameRoot,
		"MODKEEPER_FRESH_REPLACEMENT_ROOT":    root,
		"MODKEEPER_FRESH_REPLACEMENT_CONFIG":  filepath.Join(env.Root, "fresh-replacement-config.toml"),
		"MODKEEPER_FRESH_REPLACEMENT_ARCHIVE": archive,
		"MODKEEPER_FRESH_REPLACEMENT_ID":      idPath,
	}, "KILL_POINT_FRESH_AFTER_REPLACEMENT")

	idBytes, err := os.ReadFile(idPath)
	if err != nil {
		t.Fatal(err)
	}
	id := string(idBytes)
	l, err := Load(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := recoverInterruptedInstall(l); err != nil {
		t.Fatal(err)
	}
	if _, exists := l.manifest.Mods[id]; exists {
		t.Fatalf("fresh interrupted mod %q remains in manifest", id)
	}
	if _, err := os.Stat(filepath.Join(l.ModsDir, id)); !os.IsNotExist(err) {
		t.Fatalf("fresh interrupted tree %q remains: %v", id, err)
	}
	assertInstallArtifactsRemoved(t, l, id)
	if _, err := os.Stat(archive); err != nil {
		t.Fatalf("source archive was removed: %s: %v", archive, err)
	}
}

func TestFreshInstallReplacementCrashHelper(t *testing.T) {
	if os.Getenv("MODKEEPER_FRESH_REPLACEMENT_HELPER") != "1" {
		return
	}
	s, err := New(os.Getenv("MODKEEPER_FRESH_REPLACEMENT_CONFIG"))
	if err != nil {
		t.Fatal(err)
	}
	root := os.Getenv("MODKEEPER_FRESH_REPLACEMENT_ROOT")
	if err := s.CreateLibrary(models.CreateLibraryInput{
		GameRoot: os.Getenv("MODKEEPER_FRESH_REPLACEMENT_GAME"), LibraryRoot: &root,
	}); err != nil {
		t.Fatal(err)
	}
	s.installTransactionHook = func(boundary string) {
		if boundary == "after-replacement" {
			for id := range s.active.manifest.Mods {
				if err := os.WriteFile(os.Getenv("MODKEEPER_FRESH_REPLACEMENT_ID"), []byte(id), 0600); err != nil {
					t.Fatal(err)
				}
			}
			fmt.Println("KILL_POINT_FRESH_AFTER_REPLACEMENT")
			select {}
		}
	}
	installTestArchive(t, s, "fresh-crash", os.Getenv("MODKEEPER_FRESH_REPLACEMENT_ARCHIVE"))
	t.Fatal("fresh install did not reach replacement boundary")
}

func TestInstallCommitCrashHelper(t *testing.T) {
	if os.Getenv("MODKEEPER_INSTALL_COMMIT_HELPER") != "1" {
		return
	}
	s, err := New(os.Getenv("MODKEEPER_INSTALL_COMMIT_CONFIG"))
	if err != nil {
		t.Fatal(err)
	}
	root := os.Getenv("MODKEEPER_INSTALL_COMMIT_ROOT")
	if err := s.CreateLibrary(models.CreateLibraryInput{
		GameRoot: os.Getenv("MODKEEPER_INSTALL_COMMIT_GAME"), LibraryRoot: &root,
	}); err != nil {
		t.Fatal(err)
	}
	installTestArchive(t, s, "crash-v1", os.Getenv("MODKEEPER_INSTALL_COMMIT_V1"))
	var oldMod models.Mod
	var modID string
	for id, mod := range s.active.manifest.Mods {
		modID, oldMod = id, mod
	}
	oldMod.Name = "preserved old name"
	oldMod.Source = models.ModSourceForge
	oldMod.Version = installTxnTestPtr("old-version")
	oldMod.ForgeID = installTxnTestPtr(uint64(41))
	oldMod.ForgeGUID = installTxnTestPtr("old-guid")
	oldMod.ForgeKind = installTxnTestPtr(models.ForgeKindMod)
	oldMod.ForgeVersionID = installTxnTestPtr(uint64(42))
	oldMod.ForgeMetaCachedAt = installTxnTestPtr("old-metadata-time")
	s.active.manifest.Mods[modID] = oldMod
	if err := s.active.Persist(); err != nil {
		t.Fatal(err)
	}
	oldRecord, err := json.Marshal(struct {
		ID  string     `json:"id"`
		Mod models.Mod `json:"mod"`
	}{modID, oldMod})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("MODKEEPER_INSTALL_COMMIT_OLD"), oldRecord, 0600); err != nil {
		t.Fatal(err)
	}
	s.installTransactionHook = func(boundary string) {
		if boundary == "after-manifest-persist" {
			fmt.Println("KILL_POINT_AFTER_MANIFEST_PERSIST")
			select {}
		}
	}
	installTestArchive(t, s, "crash-v2", os.Getenv("MODKEEPER_INSTALL_COMMIT_V2"))
	t.Fatal("install did not reach manifest-persist boundary")
}

func TestCrashDuringInstallRecoveryCleanupIsIdempotent(t *testing.T) {
	if os.Getenv("MODKEEPER_RECOVERY_CLEANUP_HELPER") == "1" {
		return
	}
	env := testenv.New(t)
	l, err := Create(env.GameRoot, filepath.Join(env.Root, "cleanup-crash-library"), "cleanup")
	if err != nil {
		t.Fatal(err)
	}
	mod := models.Mod{ID: "CleanupMod", Name: "new", Source: models.ModSourceLocal}
	tree := filepath.Join(l.ModsDir, mod.ID)
	snapshot := installSnapshotPath(l, mod.ID)
	for path, body := range map[string]string{
		filepath.Join(tree, "version"):     "new",
		filepath.Join(snapshot, "version"): "old",
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	l.manifest.Mods[mod.ID] = mod
	if err := l.Persist(); err != nil {
		t.Fatal(err)
	}
	if err := writeInstallTransaction(installCommittedMarkerPath(l, mod.ID), installTransaction{
		Version: 1, ID: mod.ID, Phase: installCommitted, NewMod: mod,
	}); err != nil {
		t.Fatal(err)
	}

	killHelperAtBoundary(t, exec.Command(
		mustExecutable(t), "-test.run=^TestInstallRecoveryCleanupCrashHelper$",
	), map[string]string{
		"MODKEEPER_RECOVERY_CLEANUP_HELPER": "1",
		"MODKEEPER_RECOVERY_CLEANUP_ROOT":   l.Root,
	}, "KILL_POINT_AFTER_MARKER_REMOVAL")

	restarted, err := Load(l.Root)
	if err != nil {
		t.Fatal(err)
	}
	if err := recoverInterruptedInstall(restarted); err != nil {
		t.Fatal(err)
	}
	assertFileContents(t, filepath.Join(tree, "version"), "new")
	if restarted.manifest.Mods[mod.ID].Name != "new" {
		t.Fatalf("recovered manifest entry=%+v", restarted.manifest.Mods[mod.ID])
	}
	assertInstallArtifactsRemoved(t, restarted, mod.ID)
}

func TestInstallCommitMarkerExistsBeforePreparedMarkerRemoval(t *testing.T) {
	env := testenv.New(t)
	s, err := New(filepath.Join(env.Root, "commit-transition-config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(env.Root, "commit-transition-library")
	if err := s.CreateLibrary(models.CreateLibraryInput{
		GameRoot: env.GameRoot, LibraryRoot: &root,
	}); err != nil {
		t.Fatal(err)
	}
	archive := writeInstallTestArchive(t, "TransitionMod", "committed")
	transition := make(chan struct{})
	continueCommit := make(chan struct{})
	s.installTransactionHook = func(boundary string) {
		if boundary == "after-committed-marker" {
			close(transition)
			<-continueCommit
		}
	}
	if _, err := s.InstallModArchives(models.InstallModArchivesInput{
		TaskID: "transition-task", LibraryID: s.active.manifest.ID, ArchivePaths: []string{archive},
	}, nil); err != nil {
		t.Fatal(err)
	}
	select {
	case <-transition:
	case <-time.After(10 * time.Second):
		t.Fatal("install did not reach dual-marker transition")
	}
	var id string
	for id = range s.active.manifest.Mods {
		break
	}
	prepared, err := readInstallTransaction(installPreparedMarkerPath(s.active, id), id)
	if err != nil || prepared.Phase != installPrepared {
		t.Fatalf("prepared marker=%+v err=%v", prepared, err)
	}
	committed, err := readInstallTransaction(installCommittedMarkerPath(s.active, id), id)
	if err != nil || committed.Phase != installCommitted {
		t.Fatalf("committed marker=%+v err=%v", committed, err)
	}
	close(continueCommit)
	s.Wait()
	assertInstallArtifactsRemoved(t, s.active, id)
	assertFileContents(t, filepath.Join(s.active.ModsDir, id, "SPT", "user", "mods", "TransitionMod", "version"), "committed")
}

func TestCrashAfterCommittedMarkerKeepsUpgradeOnTwoRestarts(t *testing.T) {
	if os.Getenv("MODKEEPER_COMMITTED_MARKER_HELPER") == "1" {
		return
	}
	env := testenv.New(t)
	root := filepath.Join(env.Root, "committed-marker-crash-library")
	configPath := filepath.Join(env.Root, "committed-marker-crash-config.toml")
	v1Archive := writeInstallTestArchive(t, "CommittedCrashMod", "v1")
	v2Archive := writeInstallTestArchive(t, "CommittedCrashMod", "v2")
	expectedPath := filepath.Join(env.Root, "committed-crash-new-metadata.json")
	killHelperAtBoundary(t, exec.Command(
		mustExecutable(t), "-test.run=^TestInstallCommittedMarkerCrashHelper$",
	), map[string]string{
		"MODKEEPER_COMMITTED_MARKER_HELPER":   "1",
		"MODKEEPER_COMMITTED_MARKER_GAME":     env.GameRoot,
		"MODKEEPER_COMMITTED_MARKER_ROOT":     root,
		"MODKEEPER_COMMITTED_MARKER_CONFIG":   configPath,
		"MODKEEPER_COMMITTED_MARKER_V1":       v1Archive,
		"MODKEEPER_COMMITTED_MARKER_V2":       v2Archive,
		"MODKEEPER_COMMITTED_MARKER_EXPECTED": expectedPath,
	}, "KILL_POINT_AFTER_COMMITTED_MARKER")

	expectedBytes, err := os.ReadFile(expectedPath)
	if err != nil {
		t.Fatal(err)
	}
	var expected struct {
		ID  string     `json:"id"`
		Mod models.Mod `json:"mod"`
	}
	if err := json.Unmarshal(expectedBytes, &expected); err != nil {
		t.Fatal(err)
	}
	l, err := Load(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		installPreparedMarkerPath(l, expected.ID),
		installCommittedMarkerPath(l, expected.ID),
		installSnapshotPath(l, expected.ID),
	} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("crash boundary artifact %q missing: %v", path, err)
		}
	}
	assertFileContents(t, filepath.Join(l.ModsDir, expected.ID, "SPT", "user", "mods", "CommittedCrashMod", "version"), "v2")

	for restart := 1; restart <= 2; restart++ {
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
		if warning := restarted.TakeStartupWarning(); warning != nil {
			t.Fatalf("restart %d warning=%q", restart, *warning)
		}
		loaded, err := Load(root)
		if err != nil {
			t.Fatal(err)
		}
		if got := loaded.manifest.Mods[expected.ID]; !reflect.DeepEqual(got, expected.Mod) {
			t.Fatalf("restart %d committed metadata=%+v; want %+v", restart, got, expected.Mod)
		}
		assertFileContents(t, filepath.Join(loaded.ModsDir, expected.ID, "SPT", "user", "mods", "CommittedCrashMod", "version"), "v2")
		assertInstallArtifactsRemoved(t, loaded, expected.ID)
		for _, directory := range []string{loaded.BackupsDir, loaded.StagingDir} {
			entries, err := os.ReadDir(directory)
			if err != nil || len(entries) != 0 {
				t.Fatalf("restart %d artifacts in %s=%v err=%v", restart, directory, entries, err)
			}
		}
		entries, err := os.ReadDir(loaded.ModsDir)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			if strings.HasPrefix(entry.Name(), ".modkeeper-tmp-") {
				t.Fatalf("restart %d install temp remains: %s", restart, entry.Name())
			}
		}
	}
	for _, archive := range []string{v1Archive, v2Archive} {
		if _, err := os.Stat(archive); err != nil {
			t.Fatalf("source archive removed: %s: %v", archive, err)
		}
	}
}

func TestInstallCommittedMarkerCrashHelper(t *testing.T) {
	if os.Getenv("MODKEEPER_COMMITTED_MARKER_HELPER") != "1" {
		return
	}
	s, err := New(os.Getenv("MODKEEPER_COMMITTED_MARKER_CONFIG"))
	if err != nil {
		t.Fatal(err)
	}
	root := os.Getenv("MODKEEPER_COMMITTED_MARKER_ROOT")
	if err := s.CreateLibrary(models.CreateLibraryInput{
		GameRoot: os.Getenv("MODKEEPER_COMMITTED_MARKER_GAME"), LibraryRoot: &root,
	}); err != nil {
		t.Fatal(err)
	}
	installTestArchive(t, s, "committed-crash-v1", os.Getenv("MODKEEPER_COMMITTED_MARKER_V1"))
	var id string
	var old models.Mod
	for id, old = range s.active.manifest.Mods {
		break
	}
	old.Name = "old committed-crash metadata"
	old.Source = models.ModSourceForge
	old.Version = installTxnTestPtr("old-version")
	old.ForgeID = installTxnTestPtr(uint64(41))
	old.ForgeGUID = installTxnTestPtr("old-guid")
	old.ForgeKind = installTxnTestPtr(models.ForgeKindMod)
	old.ForgeVersionID = installTxnTestPtr(uint64(42))
	old.ForgeMetaCachedAt = installTxnTestPtr("old-cache-time")
	s.active.manifest.Mods[id] = old
	if err := s.active.Persist(); err != nil {
		t.Fatal(err)
	}
	s.installTransactionHook = func(boundary string) {
		if boundary != "after-committed-marker" {
			return
		}
		committed := s.active.manifest.Mods[id]
		record, err := json.Marshal(struct {
			ID  string     `json:"id"`
			Mod models.Mod `json:"mod"`
		}{id, committed})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(os.Getenv("MODKEEPER_COMMITTED_MARKER_EXPECTED"), record, 0600); err != nil {
			t.Fatal(err)
		}
		fmt.Println("KILL_POINT_AFTER_COMMITTED_MARKER")
		select {}
	}
	installTestArchive(t, s, "committed-crash-v2", os.Getenv("MODKEEPER_COMMITTED_MARKER_V2"))
	t.Fatal("install did not reach committed-marker boundary")
}

func TestCommittedMarkerWriteFailureRollsBackAndReportsTaskFailure(t *testing.T) {
	env := testenv.New(t)
	s, err := New(filepath.Join(env.Root, "commit-failure-config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(env.Root, "commit-failure-library")
	if err := s.CreateLibrary(models.CreateLibraryInput{
		GameRoot: env.GameRoot, LibraryRoot: &root,
	}); err != nil {
		t.Fatal(err)
	}
	archive := writeInstallTestArchive(t, "FailedCommitMod", "new")
	s.installMarkerWriter = func(path string, transaction installTransaction) error {
		if transaction.Phase == installCommitted {
			return fmt.Errorf("injected committed marker write failure")
		}
		return writeInstallTransaction(path, transaction)
	}
	terminal := make(chan models.TaskProgressEvent, 32)
	workspaceEvents := make(chan models.WorkspaceEvent, 2)
	s.SetEventSenders(func(event models.TaskProgressEvent) error {
		if event.Kind == models.TaskProgressCompleted {
			terminal <- event
		}
		return nil
	}, func(event models.WorkspaceEvent) error {
		workspaceEvents <- event
		return nil
	})
	if _, err := s.InstallModArchives(models.InstallModArchivesInput{
		TaskID: "failed-commit-task", LibraryID: s.active.manifest.ID, ArchivePaths: []string{archive},
	}, nil); err != nil {
		t.Fatal(err)
	}
	s.Wait()
	select {
	case event := <-terminal:
		if event.Stage != models.TaskStageTaskFailed || event.Log == nil || event.Log.Code != "task_failed" {
			t.Fatalf("terminal event=%+v; want task_failed", event)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("install task did not report a terminal result")
	}
	select {
	case event := <-workspaceEvents:
		failures, ok := event.Failures.([]models.ArchiveFailure)
		if !ok || len(failures) != 1 || !strings.Contains(fmt.Sprint(failures[0].Error.Data), "injected committed marker write failure") {
			t.Fatalf("workspace failure details=%+v", event.Failures)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("install task did not report archive failure details")
	}
	if len(s.active.manifest.Mods) != 0 {
		t.Fatalf("failed fresh install remains in manifest: %+v", s.active.manifest.Mods)
	}
	entries, err := os.ReadDir(s.active.ModsDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() == "FailedCommitMod" {
			t.Fatalf("failed fresh install tree remains: %s", entry.Name())
		}
	}
	for _, id := range []string{"FailedCommitMod"} {
		assertInstallArtifactsRemoved(t, s.active, id)
	}
}

func TestCommittedMarkerWriteErrorAfterRenameKeepsCommittedInstall(t *testing.T) {
	env := testenv.New(t)
	s, err := New(filepath.Join(env.Root, "commit-visible-config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(env.Root, "commit-visible-library")
	if err := s.CreateLibrary(models.CreateLibraryInput{
		GameRoot: env.GameRoot, LibraryRoot: &root,
	}); err != nil {
		t.Fatal(err)
	}
	archive := writeInstallTestArchive(t, "VisibleCommitMod", "new")
	injected := errors.New("injected post-rename directory-sync failure")
	s.installMarkerWriter = func(path string, transaction installTransaction) error {
		if transaction.Phase != installCommitted {
			return writeInstallTransaction(path, transaction)
		}
		if err := writeInstallTransaction(path, transaction); err != nil {
			return err
		}
		return injected
	}
	terminal := make(chan models.TaskProgressEvent, 32)
	s.SetEventSenders(func(event models.TaskProgressEvent) error {
		if event.Kind == models.TaskProgressCompleted {
			terminal <- event
		}
		return nil
	}, nil)
	if _, err := s.InstallModArchives(models.InstallModArchivesInput{
		TaskID: "visible-commit-task", LibraryID: s.active.manifest.ID, ArchivePaths: []string{archive},
	}, nil); err != nil {
		t.Fatal(err)
	}
	s.Wait()
	select {
	case event := <-terminal:
		if event.Stage != models.TaskStageTaskCompleted || event.Log == nil || event.Log.Code != "task_completed" {
			t.Fatalf("terminal event=%+v; committed install should succeed after recovery", event)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("install did not report its terminal result")
	}
	if len(s.active.manifest.Mods) != 1 {
		t.Fatalf("committed install metadata=%+v", s.active.manifest.Mods)
	}
	var id string
	for id = range s.active.manifest.Mods {
		break
	}
	assertFileContents(t, filepath.Join(s.active.ModsDir, id, "SPT", "user", "mods", "VisibleCommitMod", "version"), "new")
	assertInstallArtifactsRemoved(t, s.active, id)
	if _, err := os.Stat(archive); err != nil {
		t.Fatalf("source archive removed: %v", err)
	}
}

func TestTaskAdmissionReturnsBusyAndCancelledTaskCanFinish(t *testing.T) {
	env := testenv.New(t)
	s, err := New(filepath.Join(env.Root, "admission-busy-config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(env.Root, "admission-busy-library")
	if err := s.CreateLibrary(models.CreateLibraryInput{
		GameRoot: env.GameRoot, LibraryRoot: &root,
	}); err != nil {
		t.Fatal(err)
	}
	markerReady, resume := make(chan struct{}), make(chan struct{})
	var resumeOnce sync.Once
	resumeInstall := func() { resumeOnce.Do(func() { close(resume) }) }
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
	firstArchive := writeInstallTestArchive(t, "PausedInstall", "first")
	libraryID := s.active.manifest.ID
	if _, err := s.InstallModArchives(models.InstallModArchivesInput{
		TaskID: "first-admitted-task", LibraryID: libraryID, ArchivePaths: []string{firstArchive},
	}, nil); err != nil {
		t.Fatal(err)
	}
	defer resumeInstall()
	select {
	case <-markerReady:
	case <-time.After(10 * time.Second):
		t.Fatal("first task did not pause after preparing its install")
	}

	for _, admit := range []func() error{
		func() error {
			_, err := s.InstallModArchives(models.InstallModArchivesInput{
				TaskID: "second-install-task", LibraryID: libraryID, ArchivePaths: []string{firstArchive},
			}, nil)
			return err
		},
		func() error {
			_, err := s.SyncMods(models.SyncModsInput{TaskID: "second-sync-task", LibraryID: libraryID}, nil)
			return err
		},
	} {
		started := time.Now()
		err := admit()
		var wireError *models.Error
		if !errors.As(err, &wireError) || wireError.Code != models.LibraryBusy {
			t.Fatalf("second task admission error=%v; want typed LibraryBusy", err)
		}
		if elapsed := time.Since(started); elapsed > time.Second {
			t.Fatalf("busy admission took %s; want immediate refusal", elapsed)
		}
	}
	if err := s.CancelTask("first-admitted-task", libraryID); err != nil {
		t.Fatalf("cancel first task: %v", err)
	}
	resumeInstall()
	waited := make(chan struct{})
	go func() {
		s.Wait()
		close(waited)
	}()
	select {
	case <-waited:
	case <-time.After(5 * time.Second):
		t.Fatal("Wait did not finish after cancelling the admitted task")
	}
	if err := s.Registry.AcquireTaskID("first-admitted-task"); err != nil {
		t.Fatalf("task ID was not released when Wait returned: %v", err)
	}
	s.Registry.FinishTaskID("first-admitted-task")
	select {
	case event := <-terminal:
		if event.Stage != models.TaskStageTaskCancelled || event.Log == nil || event.Log.Code != "task_cancelled" {
			t.Fatalf("first task terminal event=%+v; want task_cancelled", event)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancelled task did not emit its terminal result")
	}
}

func TestInstallRecoveryCleanupCrashHelper(t *testing.T) {
	if os.Getenv("MODKEEPER_RECOVERY_CLEANUP_HELPER") != "1" {
		return
	}
	l, err := Load(os.Getenv("MODKEEPER_RECOVERY_CLEANUP_ROOT"))
	if err != nil {
		t.Fatal(err)
	}
	err = recoverInterruptedInstallWithHook(l, func(string) error {
		fmt.Println("KILL_POINT_AFTER_MARKER_REMOVAL")
		select {}
	})
	t.Fatalf("recovery helper returned before kill: %v", err)
}

func installTestArchive(t *testing.T, s *Service, taskID, archive string) {
	t.Helper()
	libraryID := s.active.manifest.ID
	if _, err := s.InstallModArchives(models.InstallModArchivesInput{
		TaskID: taskID, LibraryID: libraryID, ArchivePaths: []string{archive},
	}, nil); err != nil {
		t.Fatal(err)
	}
	s.Wait()
}

func writeInstallTestArchive(t *testing.T, name, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name+".zip")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	entry, err := writer.Create("SPT/user/mods/" + name + "/version")
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

func killHelperAtBoundary(t *testing.T, cmd *exec.Cmd, environment map[string]string, boundary string) {
	t.Helper()
	cmd.Args = append(cmd.Args, "-test.v")
	cmd.Env = os.Environ()
	for key, value := range environment {
		cmd.Env = append(cmd.Env, key+"="+value)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	reached := make(chan bool, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			t.Logf("crash helper: %s", scanner.Text())
			if scanner.Text() == boundary {
				reached <- true
				return
			}
		}
		reached <- false
	}()
	select {
	case ok := <-reached:
		if !ok {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			t.Fatalf("helper exited before boundary %q", boundary)
		}
	case <-time.After(60 * time.Second):
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		t.Fatalf("timed out waiting for boundary %q", boundary)
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	waitErr := cmd.Wait()
	status, ok := cmd.ProcessState.Sys().(syscall.WaitStatus)
	if !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL {
		t.Fatalf("helper was not SIGKILLed at %q: state=%v err=%v", boundary, cmd.ProcessState, waitErr)
	}
}

func mustExecutable(t *testing.T) string {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	return executable
}

func assertInstallArtifactsRemoved(t *testing.T, l *Library, id string) {
	t.Helper()
	for _, path := range []string{
		installPreparedMarkerPath(l, id),
		installCommittedMarkerPath(l, id),
		installSnapshotPath(l, id),
	} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("transaction artifact remains %q: %v", path, err)
		}
	}
}

func installTxnTestPtr[T any](value T) *T {
	return &value
}
