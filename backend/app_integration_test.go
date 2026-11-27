package backend

import (
	"archive/zip"
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/deployment"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/spt"
	"github.com/martes/modkeeper/backend/testenv"
)

func TestInstallProcessT2Journey(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("SIGKILL process test requires Unix")
	}
	env := testenv.New(t)
	root, cfg := filepath.Join(env.Root, "process-library"), filepath.Join(env.Root, "config.toml")
	archives := make([]string, 51)
	archives[0] = writeModArchiveContent(t, "First.dll", "first")
	for i := 1; i <= 25; i++ {
		archives[i] = writeModArchiveContent(t, fmt.Sprintf("Bulk%02d.dll", i), "bulk")
	}
	for i := 26; i <= 50; i++ {
		archives[i] = writeModArchiveContent(t, fmt.Sprintf("Cancelled%02d.dll", i), "cancel")
	}
	killedArchive := writeModArchiveContent(t, "Killed.dll", "killed")
	archives = append(archives, killedArchive)
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-test.run=^TestInstallProcessHelper$")
	cmd.Env = append(os.Environ(), "MODKEEPER_T2_HELPER=1", "MODKEEPER_T2_GAME="+env.GameRoot,
		"MODKEEPER_T2_ROOT="+root, "MODKEEPER_T2_CONFIG="+cfg, "MODKEEPER_T2_ARCHIVES="+strings.Join(archives, ","))
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	scanner := bufio.NewScanner(stdout)
	point := make(chan bool, 1)
	go func() {
		for scanner.Scan() {
			if scanner.Text() == "KILL_POINT_TEMP_CREATED" {
				point <- true
				return
			}
		}
		point <- false
	}()
	select {
	case reached := <-point:
		if !reached {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			t.Fatal("helper exited before deterministic kill point")
		}
	case <-time.After(60 * time.Second):
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		t.Fatal("timed out waiting for install helper kill point")
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	err = cmd.Wait()
	status, ok := cmd.ProcessState.Sys().(syscall.WaitStatus)
	if !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL {
		t.Fatalf("helper was not SIGKILLed: state=%v err=%v", cmd.ProcessState, err)
	}

	app := NewAppAt(cfg)
	if app.InitErr != nil {
		t.Fatal(app.InitErr)
	}
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := app.Library.Registry.WaitForStartupLoad(ctx); err != nil {
		t.Fatal(err)
	}
	ws, err := app.GetLibraryWorkspace()
	if err != nil || ws.ActiveLibraryID == nil {
		t.Fatalf("workspace=%+v err=%v", ws, err)
	}
	libraryID := *ws.ActiveLibraryID
	if err := app.Library.ActivateLibrary(libraryID); err != nil {
		t.Fatal(err)
	}
	ws, err = app.GetLibraryWorkspace()
	if err != nil {
		t.Fatal(err)
	}
	if got := len(ws.ModsByLibraryID[libraryID]); got != 28 {
		t.Fatalf("recovered mods=%d; want one + 25 + two committed before cancel", got)
	}
	assertManifestDiskWorkspace(t, root, ws.ModsByLibraryID[libraryID])
	for _, dir := range []string{"staging", "backups"} {
		entries, err := os.ReadDir(filepath.Join(root, dir))
		if err != nil || len(entries) != 0 {
			t.Fatalf("%s orphans=%v err=%v", dir, entries, err)
		}
	}
	modsEntries, err := os.ReadDir(filepath.Join(root, "mods"))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range modsEntries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), ".modkeeper-tmp-") {
			t.Fatalf("leftover install temp %q", entry.Name())
		}
	}
	for _, archive := range archives {
		if _, err := os.Stat(archive); err != nil {
			t.Fatalf("source archive removed: %s: %v", archive, err)
		}
	}
	followup := writeModArchiveContent(t, "Followup.dll", "ok")
	if _, err := app.InstallModArchives(models.InstallModArchivesInput{TaskID: "after-restart", LibraryID: libraryID, ArchivePaths: []string{followup}}); err != nil {
		t.Fatal(err)
	}
	app.Library.Wait()
	ws, err = app.GetLibraryWorkspace()
	if err != nil || len(ws.ModsByLibraryID[libraryID]) != 29 {
		t.Fatalf("follow-up workspace mods=%d err=%v", len(ws.ModsByLibraryID[libraryID]), err)
	}
}

func TestInstallProcessHelper(t *testing.T) {
	if os.Getenv("MODKEEPER_T2_HELPER") != "1" {
		return
	}
	game, root, cfg := os.Getenv("MODKEEPER_T2_GAME"), os.Getenv("MODKEEPER_T2_ROOT"), os.Getenv("MODKEEPER_T2_CONFIG")
	archives := strings.Split(os.Getenv("MODKEEPER_T2_ARCHIVES"), ",")
	app := NewAppAt(cfg)
	if app.InitErr != nil {
		t.Fatal(app.InitErr)
	}
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	libRoot := root
	ws, err := app.CreateLibrary(models.CreateLibraryInput{GameRoot: game, LibraryRoot: &libRoot})
	if err != nil {
		t.Fatal(err)
	}
	id := *ws.ActiveLibraryID
	install := func(task string, paths []string) {
		if _, err := app.InstallModArchives(models.InstallModArchivesInput{TaskID: task, LibraryID: id, ArchivePaths: paths}); err != nil {
			t.Fatal(err)
		}
		app.Library.Wait()
	}
	install("one", archives[:1])
	install("many", archives[1:26])
	var cancelled bool
	app.Library.SetEventSenders(func(e models.TaskProgressEvent) error {
		if e.TaskID == "cancel-in-helper" && e.Stage == models.TaskStageInstallArchives && e.Percent != nil && *e.Percent >= 8 && !cancelled {
			cancelled = true
			if err := app.CancelTask(e.TaskID, id); err != nil {
				t.Error(err)
			}
		}
		return nil
	}, nil)
	if _, err := app.InstallModArchives(models.InstallModArchivesInput{TaskID: "cancel-in-helper", LibraryID: id, ArchivePaths: archives[26:51]}); err != nil {
		t.Fatal(err)
	}
	app.Library.Wait()
	stageEvents := 0
	app.Library.SetEventSenders(func(e models.TaskProgressEvent) error {
		if e.TaskID == "kill-in-helper" && e.Stage == models.TaskStageInstallArchiveStage {
			stageEvents++
			if stageEvents == 2 {
				fmt.Println("KILL_POINT_TEMP_CREATED")
				select {}
			}
		}
		return nil
	}, nil)
	if _, err := app.InstallModArchives(models.InstallModArchivesInput{TaskID: "kill-in-helper", LibraryID: id, ArchivePaths: archives[51:]}); err != nil {
		t.Fatal(err)
	}
	app.Library.Wait()
	t.Fatal("helper did not reach kill point")
}

func TestInstallProcessT2UpgradeJourney(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("SIGKILL process test requires Unix")
	}
	env := testenv.New(t)
	root := filepath.Join(env.Root, "upgrade-process-library")
	cfg := filepath.Join(env.Root, "upgrade-process-config.toml")
	v1Archive := writeModArchiveContent(t, "Upgrade.dll", "v1")
	v2Archive := writeModArchiveContent(t, "Upgrade.dll", "v2")
	v1MetadataPath := filepath.Join(env.Root, "upgrade-v1-metadata.json")
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-test.run=^TestInstallProcessUpgradeHelper$")
	cmd.Env = append(os.Environ(),
		"MODKEEPER_T2_UPGRADE_HELPER=1",
		"MODKEEPER_T2_UPGRADE_GAME="+env.GameRoot,
		"MODKEEPER_T2_UPGRADE_ROOT="+root,
		"MODKEEPER_T2_UPGRADE_CONFIG="+cfg,
		"MODKEEPER_T2_UPGRADE_V1_ARCHIVE="+v1Archive,
		"MODKEEPER_T2_UPGRADE_V2_ARCHIVE="+v2Archive,
		"MODKEEPER_T2_UPGRADE_V1_METADATA="+v1MetadataPath,
	)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	point := make(chan bool, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			if scanner.Text() == "KILL_POINT_UPGRADE_REPLACED" {
				point <- true
				return
			}
		}
		point <- false
	}()
	select {
	case reached := <-point:
		if !reached {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			t.Fatal("upgrade helper exited before deterministic kill point")
		}
	case <-time.After(60 * time.Second):
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		t.Fatal("timed out waiting for upgrade helper kill point")
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	err = cmd.Wait()
	status, ok := cmd.ProcessState.Sys().(syscall.WaitStatus)
	if !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL {
		t.Fatalf("upgrade helper was not SIGKILLed: state=%v err=%v", cmd.ProcessState, err)
	}
	_, replacedContent, replaced := findNamedFile(t, filepath.Join(root, "mods"), "Upgrade.dll")
	if !replaced || replacedContent != "v2" {
		t.Fatalf("upgrade helper did not die after replacement: content=%q exists=%v", replacedContent, replaced)
	}

	app := NewAppAt(cfg)
	if app.InitErr != nil {
		t.Fatal(app.InitErr)
	}
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := app.Library.Registry.WaitForStartupLoad(ctx); err != nil {
		t.Fatal(err)
	}
	workspace, err := app.GetLibraryWorkspace()
	if err != nil || workspace.ActiveLibraryID == nil {
		t.Fatalf("workspace=%+v err=%v", workspace, err)
	}
	libraryID := *workspace.ActiveLibraryID
	if err := app.Library.ActivateLibrary(libraryID); err != nil {
		t.Fatal(err)
	}
	workspace, err = app.GetLibraryWorkspace()
	if err != nil {
		t.Fatal(err)
	}
	mods := workspace.ModsByLibraryID[libraryID]
	if len(mods) != 1 {
		t.Fatalf("recovered mods=%d; want exactly one", len(mods))
	}
	assertInstalledUpgradeContent(t, mods[0], "v1")
	expectedMetadata, err := os.ReadFile(v1MetadataPath)
	if err != nil {
		t.Fatal(err)
	}
	var expectedMods map[string]models.Mod
	if err := json.Unmarshal(expectedMetadata, &expectedMods); err != nil {
		t.Fatal(err)
	}
	actualMods := readManifestMods(t, root)
	if !reflect.DeepEqual(actualMods, expectedMods) {
		t.Fatalf("recovered manifest metadata=%+v; want v1 metadata=%+v", actualMods, expectedMods)
	}
	assertUpgradeArtifactsClear(t, root)
	libraryCount := len(workspace.Libraries)

	if _, err := app.InstallModArchives(models.InstallModArchivesInput{
		TaskID: "upgrade-v2-retry", LibraryID: libraryID, ArchivePaths: []string{v2Archive},
	}); err != nil {
		t.Fatal(err)
	}
	app.Library.Wait()
	workspace, err = app.GetLibraryWorkspace()
	if err != nil {
		t.Fatal(err)
	}
	mods = workspace.ModsByLibraryID[libraryID]
	if len(mods) != 1 || len(workspace.Libraries) != libraryCount {
		t.Fatalf("workspace after re-upgrade has %d mods and %d libraries; want 1 mod and stable library count %d",
			len(mods), len(workspace.Libraries), libraryCount)
	}
	assertInstalledUpgradeContent(t, mods[0], "v2")
	assertUpgradeArtifactsClear(t, root)
	for _, archive := range []string{v1Archive, v2Archive} {
		if _, err := os.Stat(archive); err != nil {
			t.Fatalf("source archive removed: %s: %v", archive, err)
		}
	}
}

func TestInstallProcessUpgradeHelper(t *testing.T) {
	if os.Getenv("MODKEEPER_T2_UPGRADE_HELPER") != "1" {
		return
	}
	game := os.Getenv("MODKEEPER_T2_UPGRADE_GAME")
	root := os.Getenv("MODKEEPER_T2_UPGRADE_ROOT")
	cfg := os.Getenv("MODKEEPER_T2_UPGRADE_CONFIG")
	v1Archive := os.Getenv("MODKEEPER_T2_UPGRADE_V1_ARCHIVE")
	v2Archive := os.Getenv("MODKEEPER_T2_UPGRADE_V2_ARCHIVE")
	app := NewAppAt(cfg)
	if app.InitErr != nil {
		t.Fatal(app.InitErr)
	}
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	libraryRoot := root
	workspace, err := app.CreateLibrary(models.CreateLibraryInput{
		GameRoot: game, LibraryRoot: &libraryRoot,
	})
	if err != nil {
		t.Fatal(err)
	}
	libraryID := *workspace.ActiveLibraryID
	if _, err := app.InstallModArchives(models.InstallModArchivesInput{
		TaskID: "upgrade-v1", LibraryID: libraryID, ArchivePaths: []string{v1Archive},
	}); err != nil {
		t.Fatal(err)
	}
	app.Library.Wait()
	metadata, err := json.Marshal(readManifestMods(t, root))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(os.Getenv("MODKEEPER_T2_UPGRADE_V1_METADATA"), metadata, 0600); err != nil {
		t.Fatal(err)
	}

	stageEvents := 0
	app.Library.SetEventSenders(func(event models.TaskProgressEvent) error {
		if event.TaskID == "upgrade-v2" && event.Stage == models.TaskStageInstallArchiveStage {
			stageEvents++
			if stageEvents == 3 {
				// The third existing stage event is emitted after the replacement rename,
				// before the manifest commit removes the pending marker and snapshot.
				fmt.Println("KILL_POINT_UPGRADE_REPLACED")
				select {}
			}
		}
		return nil
	}, nil)
	if _, err := app.InstallModArchives(models.InstallModArchivesInput{
		TaskID: "upgrade-v2", LibraryID: libraryID, ArchivePaths: []string{v2Archive},
	}); err != nil {
		t.Fatal(err)
	}
	app.Library.Wait()
	t.Fatal("upgrade helper did not reach kill point")
}

func TestSyncProcessT2CrashAfterMutation(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("SIGKILL process test requires Unix")
	}
	env := testenv.New(t)
	root := filepath.Join(env.Root, "sync-crash-library")
	cfg := filepath.Join(env.Root, "sync-crash-config.toml")
	app := NewAppAt(cfg)
	if app.InitErr != nil {
		t.Fatal(app.InitErr)
	}
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	libraryRoot := root
	workspace, err := app.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &libraryRoot})
	if err != nil {
		t.Fatal(err)
	}
	libraryID := *workspace.ActiveLibraryID
	archive := writeModArchiveContent(t, "SyncCrash.dll", "owned")
	if _, err := app.InstallModArchives(models.InstallModArchivesInput{
		TaskID: "sync-crash-install", LibraryID: libraryID, ArchivePaths: []string{archive},
	}); err != nil {
		t.Fatal(err)
	}
	app.Library.Wait()
	if _, err := app.SyncMods(models.SyncModsInput{TaskID: "sync-crash-initial", LibraryID: libraryID}); err != nil {
		t.Fatal(err)
	}
	app.Library.Wait()
	unrelated := filepath.Join(env.GameRoot, "SPT", "user", "mods", "user-data.txt")
	if err := os.WriteFile(unrelated, []byte("keep"), 0644); err != nil {
		t.Fatal(err)
	}
	workspace, err = app.GetLibraryWorkspace()
	if err != nil {
		t.Fatal(err)
	}
	var syncCrashID string
	for _, mod := range workspace.ModsByLibraryID[libraryID] {
		if mod.Name == "mod" {
			syncCrashID = mod.ID
		}
	}
	if syncCrashID == "" {
		t.Fatal("SyncCrash mod was not installed")
	}
	if _, err := app.BulkUpdateMods(models.BulkUpdateModsInput{
		LibraryID: libraryID, ModIDs: []string{syncCrashID}, Action: models.BulkActionDisable,
	}); err != nil {
		t.Fatal(err)
	}
	deployed, _, exists := findNamedFile(t, env.GameRoot, "SyncCrash.dll")
	if !exists {
		t.Fatal("expected SyncCrash.dll to be deployed before crash")
	}

	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-test.run=^TestSyncProcessCrashHelper$")
	cmd.Env = append(os.Environ(), "MODKEEPER_T2_SYNC_HELPER=1", "MODKEEPER_T2_SYNC_CONFIG="+cfg)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	point := make(chan bool, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			if scanner.Text() == "KILL_POINT_SYNC_MUTATION" {
				point <- true
				return
			}
		}
		point <- false
	}()
	select {
	case reached := <-point:
		if !reached {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			t.Fatal("sync helper exited before the post-mutation/pre-commit boundary")
		}
	case <-time.After(60 * time.Second):
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		t.Fatal("timed out waiting for sync mutation boundary")
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	err = cmd.Wait()
	status, ok := cmd.ProcessState.Sys().(syscall.WaitStatus)
	if !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL {
		t.Fatalf("sync helper was not SIGKILLed: state=%v err=%v", cmd.ProcessState, err)
	}

	if _, err := os.Stat(deployed); !os.IsNotExist(err) {
		t.Fatalf("deployment removal did not occur before kill: %v", err)
	}
	if got, err := os.ReadFile(unrelated); err != nil || string(got) != "keep" {
		t.Fatalf("unrelated game file changed: %q %v", got, err)
	}
	restarted := NewAppAt(cfg)
	if restarted.InitErr != nil {
		t.Fatal(restarted.InitErr)
	}
	if err := restarted.Start(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := restarted.Library.Registry.WaitForStartupLoad(ctx); err != nil {
		t.Fatal(err)
	}
	terminalEvents := make(chan models.TaskProgressEvent, 32)
	restarted.Library.SetEventSenders(func(event models.TaskProgressEvent) error {
		if event.TaskID == "sync-crash-retry" {
			terminalEvents <- event
		}
		return nil
	}, nil)
	if _, err := restarted.SyncMods(models.SyncModsInput{TaskID: "sync-crash-retry", LibraryID: libraryID}); err != nil {
		t.Fatal(err)
	}
	restarted.Library.Wait()
	var terminal *models.TaskProgressEvent
	for len(terminalEvents) > 0 {
		event := <-terminalEvents
		if event.Kind == models.TaskProgressCompleted {
			terminal = &event
		}
	}
	if terminal == nil || terminal.Stage != models.TaskStageTaskCompleted ||
		terminal.Log == nil || terminal.Log.Code != "task_completed" {
		t.Fatalf("sync retry terminal event=%+v; want task_completed", terminal)
	}
	if _, err := os.Stat(deployed); !os.IsNotExist(err) {
		t.Fatalf("retry did not converge to disabled plan: %v", err)
	}
	rules, err := spt.Discover(env.GameRoot)
	if err != nil {
		t.Fatal(err)
	}
	state, err := deployment.LoadState(deployment.Layout{
		LibraryRoot: root, GameRoot: env.GameRoot, Rules: rules,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Artifacts) != 0 {
		t.Fatalf("persisted deployment state still lists artifacts: %+v", state.Artifacts)
	}
	if got, err := os.ReadFile(unrelated); err != nil || string(got) != "keep" {
		t.Fatalf("unrelated game file did not survive retry: %q %v", got, err)
	}
}

func TestSyncProcessCrashHelper(t *testing.T) {
	if os.Getenv("MODKEEPER_T2_SYNC_HELPER") != "1" {
		return
	}
	app := NewAppAt(os.Getenv("MODKEEPER_T2_SYNC_CONFIG"))
	if app.InitErr != nil {
		t.Fatal(app.InitErr)
	}
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := app.Library.Registry.WaitForStartupLoad(ctx); err != nil {
		t.Fatal(err)
	}
	workspace, err := app.GetLibraryWorkspace()
	if err != nil || workspace.ActiveLibraryID == nil {
		t.Fatalf("workspace=%+v err=%v", workspace, err)
	}
	libraryID := *workspace.ActiveLibraryID
	app.Library.SetEventSenders(func(event models.TaskProgressEvent) error {
		if event.TaskID == "sync-crash-kill" && event.Stage == models.TaskStageSyncPersist {
			fmt.Println("KILL_POINT_SYNC_MUTATION")
			select {}
		}
		return nil
	}, nil)
	if _, err := app.SyncMods(models.SyncModsInput{TaskID: "sync-crash-kill", LibraryID: libraryID}); err != nil {
		t.Fatal(err)
	}
	app.Library.Wait()
	t.Fatal("sync helper did not reach post-mutation/pre-commit boundary")
}

func TestStartRecoversInterruptedInstallArtifacts(t *testing.T) {
	env := testenv.New(t)
	cfg := filepath.Join(env.Root, "startup-recovery-config.toml")
	root := filepath.Join(env.Root, "startup-recovery-library")
	app := NewAppAt(cfg)
	if app.InitErr != nil {
		t.Fatal(app.InitErr)
	}
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	libraryRoot := root
	if _, err := app.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &libraryRoot}); err != nil {
		t.Fatal(err)
	}
	mods := filepath.Join(root, "mods", "RecoverMe")
	snapshot := filepath.Join(root, "backups", "RecoverMe.snapshot")
	staging := filepath.Join(root, "staging", "interrupted")
	userDir := filepath.Join(root, "staging-user-data")
	for _, dir := range []string{mods, snapshot, staging, userDir} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	for path, body := range map[string]string{
		filepath.Join(mods, "version"):     "new",
		filepath.Join(snapshot, "version"): "old",
		filepath.Join(staging, "partial"):  "x",
		filepath.Join(userDir, "keep.txt"): "keep",
	} {
		if err := os.WriteFile(path, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	oldMod := models.Mod{ID: "RecoverMe", Name: "old", Type: models.ModTypeServer, Source: models.ModSourceLocal}
	newMod := models.Mod{ID: "RecoverMe", Name: "new", Type: models.ModTypeServer, Source: models.ModSourceLocal}
	var diskManifest struct {
		ID         string                `toml:"id"`
		Name       string                `toml:"name"`
		GameRoot   string                `toml:"gameRoot"`
		RepoRoot   string                `toml:"repoRoot"`
		SPTVersion string                `toml:"sptVersion"`
		Mods       map[string]models.Mod `toml:"mods"`
		IsDirty    bool                  `toml:"isDirty"`
	}
	if _, err := toml.DecodeFile(filepath.Join(root, "manifest.toml"), &diskManifest); err != nil {
		t.Fatal(err)
	}
	diskManifest.Mods[oldMod.ID] = newMod
	manifestFile, err := os.Create(filepath.Join(root, "manifest.toml"))
	if err != nil {
		t.Fatal(err)
	}
	if err := toml.NewEncoder(manifestFile).Encode(diskManifest); err != nil {
		t.Fatal(err)
	}
	if err := manifestFile.Close(); err != nil {
		t.Fatal(err)
	}
	marker, err := json.Marshal(struct {
		Version int         `json:"version"`
		ID      string      `json:"id"`
		Phase   string      `json:"phase"`
		HadOld  bool        `json:"hadOld"`
		OldMod  *models.Mod `json:"oldMod,omitempty"`
		NewMod  models.Mod  `json:"newMod"`
	}{1, "RecoverMe", "prepared", true, &oldMod, newMod})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "backups", "RecoverMe.install.prepared"), marker, 0600); err != nil {
		t.Fatal(err)
	}

	restarted := NewAppAt(cfg)
	if restarted.InitErr != nil {
		t.Fatal(restarted.InitErr)
	}
	if err := restarted.Start(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := restarted.Library.Registry.WaitForStartupLoad(ctx); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(mods, "version"))
	if err != nil || string(body) != "old" {
		t.Fatalf("startup recovery restored=%q err=%v", body, err)
	}
	for _, dir := range []string{filepath.Join(root, "staging"), filepath.Join(root, "backups")} {
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) != 0 {
			t.Fatalf("startup recovery left %s: %v err=%v", dir, entries, err)
		}
	}
	if body, err := os.ReadFile(filepath.Join(userDir, "keep.txt")); err != nil || string(body) != "keep" {
		t.Fatalf("similarly named user directory changed: %q %v", body, err)
	}
}

func assertInstalledUpgradeContent(t *testing.T, mod models.ModSummary, want string) {
	t.Helper()
	if mod.InstalledPath == nil {
		t.Fatal("mod has no installed path")
	}
	path := filepath.Join(*mod.InstalledPath, "SPT", "user", "mods", "Upgrade", "Upgrade.dll")
	body, err := os.ReadFile(path)
	if err != nil || string(body) != want {
		t.Fatalf("installed upgrade content=%q; want %q: %v", body, want, err)
	}
}

func readManifestMods(t *testing.T, root string) map[string]models.Mod {
	t.Helper()
	var disk struct {
		Mods map[string]models.Mod `toml:"mods"`
	}
	if _, err := toml.DecodeFile(filepath.Join(root, "manifest.toml"), &disk); err != nil {
		t.Fatal(err)
	}
	return disk.Mods
}

func TestPurgeProcessT2CrashAfterQuarantine(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("SIGKILL process test requires Unix")
	}
	env := testenv.New(t)
	libraryRoot := filepath.Join(env.Root, "purge-crash-library")
	configPath := filepath.Join(env.Root, "purge-crash-config.toml")
	app := NewAppAt(configPath)
	if app.InitErr != nil {
		t.Fatal(app.InitErr)
	}
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	libraryRootArg := libraryRoot
	workspace, err := app.CreateLibrary(models.CreateLibraryInput{
		GameRoot: env.GameRoot, LibraryRoot: &libraryRootArg,
	})
	if err != nil {
		t.Fatal(err)
	}
	libraryID := *workspace.ActiveLibraryID
	modsRoot := filepath.Join(libraryRoot, "mods")
	if err := os.MkdirAll(modsRoot, 0700); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(modsRoot, "owned.dll")
	if err := os.WriteFile(target, []byte("owned"), 0600); err != nil {
		t.Fatal(err)
	}
	rules, err := spt.Discover(env.GameRoot)
	if err != nil {
		t.Fatal(err)
	}
	protected := filepath.Join(env.GameRoot, filepath.FromSlash(rules.ServerMods))
	if err := os.MkdirAll(protected, 0755); err != nil {
		t.Fatal(err)
	}
	ownedLink := filepath.Join(protected, "owned.dll")
	if err := os.Symlink(target, ownedLink); err != nil {
		t.Fatal(err)
	}
	external := filepath.Join(env.Root, "external.dll")
	if err := os.WriteFile(external, []byte("external"), 0600); err != nil {
		t.Fatal(err)
	}
	externalLink := filepath.Join(protected, "external.dll")
	if err := os.Symlink(external, externalLink); err != nil {
		t.Fatal(err)
	}

	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(exe, "-test.run=^TestPurgeProcessCrashHelper$")
	cmd.Env = append(os.Environ(), "MODKEEPER_T2_PURGE_HELPER=1",
		"MODKEEPER_T2_PURGE_GAME="+env.GameRoot, "MODKEEPER_T2_PURGE_LIBRARY="+libraryRoot)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	point := make(chan bool, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			if scanner.Text() == "KILL_POINT_PURGE_QUARANTINED" {
				point <- true
				return
			}
		}
		point <- false
	}()
	select {
	case reached := <-point:
		if !reached {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
			t.Fatal("purge helper exited before moving an owned link to quarantine")
		}
	case <-time.After(60 * time.Second):
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		t.Fatal("timed out waiting for purge quarantine boundary")
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	err = cmd.Wait()
	status, ok := cmd.ProcessState.Sys().(syscall.WaitStatus)
	if !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL {
		t.Fatalf("purge helper was not SIGKILLed: state=%v err=%v", cmd.ProcessState, err)
	}
	if _, err := os.Lstat(ownedLink); !os.IsNotExist(err) {
		t.Fatalf("owned link was not quarantined before kill: %v", err)
	}
	entries, err := os.ReadDir(protected)
	if err != nil {
		t.Fatal(err)
	}
	quarantines := 0
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".mkp-") {
			quarantines++
		}
	}
	if quarantines != 1 {
		t.Fatalf("quarantine entries=%d; want 1: %v", quarantines, entries)
	}
	if got, err := os.ReadFile(external); err != nil || string(got) != "external" {
		t.Fatalf("external target changed: %q %v", got, err)
	}
	journal := filepath.Join(libraryRoot, ".modkeeper-purge-recovery.toml")
	if _, err := os.Stat(journal); err != nil {
		t.Fatalf("purge journal was not retained: %v", err)
	}
	restarted := NewAppAt(configPath)
	if restarted.InitErr != nil {
		t.Fatal(restarted.InitErr)
	}
	if err := restarted.Start(); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := restarted.Library.Registry.WaitForStartupLoad(ctx); err != nil {
		t.Fatal(err)
	}
	retryErr := restarted.Library.DeleteLibrary(libraryID, true)
	var purgeError *models.Error
	if !errors.As(retryErr, &purgeError) || purgeError.Code != "InvalidLibrary" ||
		!strings.Contains(retryErr.Error(), "Purge recovery is pending; explicit recovery is required before retrying") {
		t.Fatalf("restarted app purge retry error=%v; want retained-journal refusal", retryErr)
	}
	if restarted.Library.Store.Config.FindLibrary(libraryID) == nil {
		t.Fatal("blocked purge retry unexpectedly unregistered the library")
	}
	if _, err := os.Stat(journal); err != nil {
		t.Fatalf("blocked retry removed purge journal: %v", err)
	}
	if retryErr == nil {
		t.Fatal("purge retry should refuse the retained journal until explicit recovery")
	}
	if got, err := os.ReadFile(external); err != nil || string(got) != "external" {
		t.Fatalf("external target changed after blocked retry: %q %v", got, err)
	}
}

func TestPurgeProcessCrashHelper(t *testing.T) {
	if os.Getenv("MODKEEPER_T2_PURGE_HELPER") != "1" {
		return
	}
	gameRoot := os.Getenv("MODKEEPER_T2_PURGE_GAME")
	rules, err := spt.Discover(gameRoot)
	if err != nil {
		t.Fatal(err)
	}
	layout := deployment.Layout{
		LibraryRoot: os.Getenv("MODKEEPER_T2_PURGE_LIBRARY"),
		GameRoot:    gameRoot,
		Rules:       rules,
	}
	if err := deployment.PurgeWithProgress(layout, nil, func() {
		fmt.Println("KILL_POINT_PURGE_QUARANTINED")
		select {}
	}); err != nil {
		t.Fatal(err)
	}
	t.Fatal("purge helper did not reach quarantine boundary")
}

func findNamedFile(t *testing.T, root, name string) (string, string, bool) {
	t.Helper()
	var foundPath, contents string
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && entry.Name() == name {
			body, readErr := os.ReadFile(path)
			if readErr != nil {
				return readErr
			}
			foundPath, contents = path, string(body)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return foundPath, contents, foundPath != ""
}

func assertUpgradeArtifactsClear(t *testing.T, root string) {
	t.Helper()
	for _, dir := range []string{"staging", "backups"} {
		entries, err := os.ReadDir(filepath.Join(root, dir))
		if err != nil || len(entries) != 0 {
			t.Fatalf("%s orphans=%v err=%v", dir, entries, err)
		}
	}
	err := filepath.WalkDir(filepath.Join(root, "mods"), func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if strings.HasPrefix(entry.Name(), ".modkeeper-tmp-") {
			t.Errorf("leftover install temp %q", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if strings.HasSuffix(entry.Name(), ".install.prepared") ||
			strings.HasSuffix(entry.Name(), ".install.committed") ||
			strings.HasSuffix(entry.Name(), ".snapshot") {
			t.Errorf("leftover recovery artifact %q", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func assertManifestDiskWorkspace(t *testing.T, root string, workspaceMods []models.ModSummary) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(root, "manifest.toml"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Mods map[string]models.Mod `toml:"mods"`
	}
	if _, err := toml.Decode(string(b), &manifest); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(root, "mods"))
	if err != nil {
		t.Fatal(err)
	}
	dirs := map[string]bool{}
	for _, entry := range entries {
		if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") {
			dirs[entry.Name()] = true
		}
	}
	if len(dirs) != len(manifest.Mods) {
		extra := []string{}
		for id := range dirs {
			if _, ok := manifest.Mods[id]; !ok {
				entries, _ := os.ReadDir(filepath.Join(root, "mods", id))
				extra = append(extra, fmt.Sprintf("%s:%v", id, entries))
			}
		}
		t.Fatalf("disk=%d manifest=%d extra=%v", len(dirs), len(manifest.Mods), extra)
	}
	for id := range manifest.Mods {
		if !dirs[id] {
			t.Fatalf("manifest mod %q absent from disk", id)
		}
	}
	if len(workspaceMods) != len(manifest.Mods) {
		workspaceIDs := map[string]bool{}
		for _, row := range workspaceMods {
			workspaceIDs[row.ID] = true
		}
		for id, mod := range manifest.Mods {
			if !workspaceIDs[id] {
				t.Fatalf("workspace omits manifest mod %q (%s)", id, mod.Name)
			}
		}
	}
}

func TestCancelInstallBatchCommitsCompletedArchives(t *testing.T) {
	count := 25
	if value := os.Getenv("MODKEEPER_INSTALL_ARCHIVE_COUNT"); value != "" {
		n, err := strconv.Atoi(value)
		if err != nil || n < 25 {
			t.Fatalf("MODKEEPER_INSTALL_ARCHIVE_COUNT must be >=25: %q", value)
		}
		count = n
	}
	env := testenv.New(t)
	app := NewAppAt(filepath.Join(t.TempDir(), "config.toml"))
	if app.InitErr != nil {
		t.Fatal(app.InitErr)
	}
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(env.Root, "cancel-library")
	ws, err := app.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &root})
	if err != nil {
		t.Fatal(err)
	}
	libraryID := *ws.ActiveLibraryID
	archives := make([]string, count)
	for i := range archives {
		archives[i] = writeModArchiveContent(t, fmt.Sprintf("Batch%03d.dll", i), "payload")
	}
	reached, resume := make(chan struct{}), make(chan struct{})
	var once sync.Once
	var mu sync.Mutex
	var progressEvents []models.TaskProgressEvent
	var workspaceEvents []models.WorkspaceEvent
	app.Library.SetEventSenders(func(event models.TaskProgressEvent) error {
		mu.Lock()
		progressEvents = append(progressEvents, event)
		mu.Unlock()
		if event.Stage == models.TaskStageInstallArchives && event.Percent != nil && *event.Percent >= 100/float64(count)*2 {
			once.Do(func() { close(reached); <-resume })
		}
		return nil
	}, func(event models.WorkspaceEvent) error {
		mu.Lock()
		workspaceEvents = append(workspaceEvents, event)
		mu.Unlock()
		return nil
	})
	const taskID = "cancel-batch"
	if _, err := app.InstallModArchives(models.InstallModArchivesInput{TaskID: taskID, LibraryID: libraryID, ArchivePaths: archives}); err != nil {
		t.Fatal(err)
	}
	select {
	case <-reached:
	case <-time.After(60 * time.Second):
		t.Fatal("timed out waiting for cancellation progress boundary")
	}
	if err := app.CancelTask(taskID, libraryID); err != nil {
		t.Fatal(err)
	}
	if err := app.CancelTask(taskID, libraryID); err == nil {
		t.Fatal("repeat cancellation should report TaskAlreadyCancelled")
	}
	close(resume)
	app.Library.Wait()
	mu.Lock()
	events := append([]models.TaskProgressEvent(nil), progressEvents...)
	workspaces := append([]models.WorkspaceEvent(nil), workspaceEvents...)
	mu.Unlock()
	if len(events) == 0 || events[len(events)-1].Kind != models.TaskProgressCompleted || events[len(events)-1].Stage != models.TaskStageTaskCancelled {
		t.Fatalf("terminal progress: %+v", events)
	}
	workspace, err := app.GetLibraryWorkspace()
	if err != nil {
		t.Fatal(err)
	}
	mods := workspace.ModsByLibraryID[libraryID]
	if len(mods) != 2 {
		t.Fatalf("completed count=%d; want 2", len(mods))
	}
	wantCommitted := map[string]string{"Batch000.dll": "payload", "Batch001.dll": "payload"}
	gotFiles := map[string]bool{}
	for _, mod := range mods {
		err := filepath.WalkDir(*mod.InstalledPath, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".dll") {
				body, err := os.ReadFile(path)
				if err != nil {
					return err
				}
				gotFiles[entry.Name()] = true
				if want, ok := wantCommitted[entry.Name()]; !ok || string(body) != want {
					t.Errorf("unexpected committed archive file %s=%q", entry.Name(), body)
				}
				delete(wantCommitted, entry.Name())
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(wantCommitted) != 0 {
		t.Fatalf("committed IDs missing after cancellation: %v", wantCommitted)
	}
	for i := 2; i < count; i++ {
		name := fmt.Sprintf("Batch%03d.dll", i)
		if gotFiles[name] {
			t.Fatalf("cancelled archive %q is present in workspace", name)
		}
		if _, _, exists := findNamedFile(t, filepath.Join(root, "mods"), name); exists {
			t.Fatalf("cancelled archive file %q remains on disk", name)
		}
	}
	if len(workspaces) != 1 || len(workspaces[0].Workspace.ModsByLibraryID[libraryID]) != 2 {
		t.Fatalf("cancellation workspace event=%+v", workspaces)
	}
	manifestBytes, err := os.ReadFile(filepath.Join(root, "manifest.toml"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Mods map[string]models.Mod `toml:"mods"`
	}
	if _, err := toml.Decode(string(manifestBytes), &manifest); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(root, "mods"))
	if err != nil {
		t.Fatal(err)
	}
	dirs := 0
	for _, entry := range entries {
		if entry.IsDir() && !strings.HasPrefix(entry.Name(), ".") {
			dirs++
		}
	}
	if dirs != len(manifest.Mods) || dirs != len(mods) {
		t.Fatalf("disk=%d manifest=%d workspace=%d", dirs, len(manifest.Mods), len(mods))
	}
	for _, name := range []string{"staging", "backups"} {
		entries, err := os.ReadDir(filepath.Join(root, name))
		if err != nil || len(entries) != 0 {
			t.Fatalf("%s orphan entries=%v err=%v", name, entries, err)
		}
	}
	// The task ID is released on cancellation.
	next := writeModArchiveContent(t, "AfterCancel.dll", "ok")
	if _, err := app.InstallModArchives(models.InstallModArchivesInput{TaskID: taskID, LibraryID: libraryID, ArchivePaths: []string{next}}); err != nil {
		t.Fatalf("reusing task ID: %v", err)
	}
	app.Library.Wait()
	workspace, err = app.GetLibraryWorkspace()
	if err != nil {
		t.Fatal(err)
	}
	mods = workspace.ModsByLibraryID[libraryID]
	if len(mods) != 3 {
		t.Fatalf("task ID reuse installed %d mods; want 3", len(mods))
	}
	foundFollowup := false
	_, body, foundFollowup := findNamedFile(t, filepath.Join(root, "mods"), "AfterCancel.dll")
	if foundFollowup && body != "ok" {
		t.Fatalf("follow-up content=%q", body)
	}
	if !foundFollowup {
		t.Fatal("reused task ID did not install AfterCancel")
	}
}

type captureSink struct {
	progress   []models.TaskProgressEvent
	workspaces []models.WorkspaceEvent
}

func TestInstallManyArchives(t *testing.T) {
	env, archives := seedInstallFixture(t, 25, "Mod")
	app := NewAppAt(filepath.Join(t.TempDir(), "config.toml"))
	if app.InitErr != nil {
		t.Fatal(app.InitErr)
	}
	if err := app.Start(); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(env.Root, "library")
	workspace, err := app.CreateLibrary(models.CreateLibraryInput{GameRoot: env.GameRoot, LibraryRoot: &root})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.InstallModArchives(models.InstallModArchivesInput{TaskID: "many", LibraryID: *workspace.ActiveLibraryID, ArchivePaths: archives}); err != nil {
		t.Fatal(err)
	}
	app.Library.Wait()
	ws, err := app.GetLibraryWorkspace()
	if err != nil || len(ws.ModsByLibraryID[*workspace.ActiveLibraryID]) != len(archives) {
		t.Fatalf("workspace mods=%d err=%v", len(ws.ModsByLibraryID[*workspace.ActiveLibraryID]), err)
	}
	mods := ws.ModsByLibraryID[*workspace.ActiveLibraryID]
	got := make(map[string]bool, len(mods))
	for _, mod := range mods {
		err := filepath.WalkDir(*mod.InstalledPath, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".dll") {
				got[entry.Name()] = true
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	for i := range archives {
		name := fmt.Sprintf("Mod%03d.dll", i)
		if !got[name] {
			t.Errorf("missing expected archive file %q", name)
		}
		delete(got, name)
	}
	if len(got) != 0 {
		t.Errorf("unexpected archive files: %v", got)
	}
	if mods[0].InstalledPath == nil {
		t.Fatal("first installed mod has no path")
	}
	_, body, exists := findNamedFile(t, filepath.Join(root, "mods"), "Mod000.dll")
	if !exists || body != "fixture payload" {
		t.Fatalf("first archive content=%q", body)
	}
	for _, dir := range []string{"staging", "backups"} {
		entries, readErr := os.ReadDir(filepath.Join(root, dir))
		if readErr != nil || len(entries) != 0 {
			t.Fatalf("%s entries=%v err=%v", dir, entries, readErr)
		}
	}
}

func seedInstallFixture(t *testing.T, count int, prefix string) (*testenv.Env, []string) {
	t.Helper()
	env := testenv.New(t)
	archives := make([]string, count)
	for i := range archives {
		archives[i] = writeModArchiveContent(t, fmt.Sprintf("%s%03d.dll", prefix, i), "fixture payload")
	}
	return env, archives
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
	t.Cleanup(func() {
		if err := deployment.CloseLiveDeploymentStates(); err != nil {
			t.Errorf("close deployment pins: %v", err)
		}
	})

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

// TestInstallUpgradeLeavesNoSnapshot verifies that a second install replaces
// the mod content without creating a backup snapshot.
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
