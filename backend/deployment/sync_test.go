package deployment

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/linker"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/spt"
)

func TestSyncCrashProcessChild(t *testing.T) {
	if os.Getenv("MODKEEPER_SYNC_CRASH_CHILD") != "1" {
		return
	}
	l := Layout{LibraryRoot: os.Getenv("MODKEEPER_SYNC_LIBRARY"), GameRoot: os.Getenv("MODKEEPER_SYNC_GAME")}
	var err error
	l.Rules, err = spt.Discover(l.GameRoot)
	if err != nil {
		t.Fatal(err)
	}
	if os.Getenv("MODKEEPER_SYNC_PREDEPLOY") == "1" {
		mods := []models.Mod{{ID: "a", Enabled: true}}
		syncMods(t, l, mods...)
		if err := os.WriteFile(filepath.Join(l.Paths().Mods, "a/BepInEx/plugins/a.dll"), []byte("new bytes"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	wanted := os.Getenv("MODKEEPER_SYNC_BOUNDARY")
	_, err = syncWithHooks(context.Background(), l, []models.Mod{{ID: "a", Enabled: true}}, nil, nil, func(boundary string) error {
		if boundary != wanted {
			return nil
		}
		_, _ = fmt.Fprintln(os.Stdout, "SYNC_BOUNDARY_READY")
		select {}
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Fatal("child sync completed without reaching the requested kill boundary")
}

func TestSyncCompletionProcessChild(t *testing.T) {
	mode := os.Getenv("MODKEEPER_SYNC_COMPLETE_CHILD")
	if mode == "" {
		return
	}
	l := Layout{LibraryRoot: os.Getenv("MODKEEPER_SYNC_LIBRARY"), GameRoot: os.Getenv("MODKEEPER_SYNC_GAME")}
	var err error
	l.Rules, err = spt.Discover(l.GameRoot)
	if err != nil {
		t.Fatal(err)
	}
	var mods []models.Mod
	if mode == "copy" || mode == "enabled" {
		mods = []models.Mod{{ID: "a", Enabled: true}}
	}
	if _, err := Sync(context.Background(), l, mods, nil); err != nil {
		t.Fatal(err)
	}
}

func runSyncCompletionChild(t *testing.T, l Layout, mode string) {
	t.Helper()
	command := exec.Command(os.Args[0], "-test.run=^TestSyncCompletionProcessChild$")
	command.Env = append(os.Environ(),
		"MODKEEPER_SYNC_COMPLETE_CHILD="+mode,
		"MODKEEPER_SYNC_LIBRARY="+l.LibraryRoot,
		"MODKEEPER_SYNC_GAME="+l.GameRoot,
	)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("completed Sync child failed: %v; output=%s", err, output)
	}
}

func killSyncChildAt(t *testing.T, l Layout, boundary string, predeploy ...bool) {
	t.Helper()
	command := exec.Command(os.Args[0], "-test.run=^TestSyncCrashProcessChild$")
	command.Env = append(os.Environ(),
		"MODKEEPER_SYNC_CRASH_CHILD=1",
		"MODKEEPER_SYNC_LIBRARY="+l.LibraryRoot,
		"MODKEEPER_SYNC_GAME="+l.GameRoot,
		"MODKEEPER_SYNC_BOUNDARY="+boundary,
	)
	if len(predeploy) > 0 && predeploy[0] {
		command.Env = append(command.Env, "MODKEEPER_SYNC_PREDEPLOY=1")
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr strings.Builder
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	ready := false
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		if scanner.Text() == "SYNC_BOUNDARY_READY" {
			ready = true
			break
		}
	}
	if !ready {
		_ = command.Process.Kill()
		_ = command.Wait()
		t.Fatalf("child did not reach %s: scanner=%v stderr=%s", boundary, scanner.Err(), stderr.String())
	}
	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	if err := command.Wait(); err == nil {
		t.Fatal("child process was not killed")
	}
}

func TestSyncRecoversPreexistingOwnedTargetAfterIntentCrash(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "old bytes"})
	target := filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll")
	killSyncChildAt(t, l, "intent-persisted", true)
	content(t, target, "old bytes")
	if _, err := Sync(context.Background(), l, []models.Mod{m}, nil); err != nil {
		t.Fatalf("recovery did not accept the authenticated previous artifact: %v", err)
	}
	content(t, target, "new bytes")
	must(t, CheckNoPendingSync(l))
}

func TestCompletedEmptySyncJournalIsRecognizedAfterProcessRestart(t *testing.T) {
	l := fixture(t)
	runSyncCompletionChild(t, l, "empty")
	must(t, recoverSyncIntent(l))
	must(t, CheckNoPendingSync(l))
	state, err := LoadState(l)
	must(t, err)
	if len(state.Artifacts) != 0 || len(state.CreatedDirs) != 0 {
		t.Fatalf("empty Sync created deployment state: %+v", state)
	}
}

func TestRestartedEmptySyncCanStartNewOperationWithoutChangingCompletedJournal(t *testing.T) {
	l := fixture(t)
	runSyncCompletionChild(t, l, "empty")
	oldJournal, err := os.ReadFile(l.Paths().SyncIntent)
	must(t, err)
	mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "new payload"})
	runSyncCompletionChild(t, l, "enabled")
	content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll"), "new payload")
	oldJournalAfter, err := os.ReadFile(l.Paths().SyncIntent)
	must(t, err)
	if string(oldJournalAfter) != string(oldJournal) {
		t.Fatal("new Sync modified the prior completed journal")
	}
	entries, err := os.ReadDir(l.LibraryRoot)
	must(t, err)
	var operationJournals int
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), syncOperationJournalPrefix) {
			operationJournals++
			journal, readErr := readSyncIntentRecords(filepath.Join(l.LibraryRoot, entry.Name()))
			must(t, readErr)
			completed, stateErr := syncJournalCompletionState(journal)
			must(t, stateErr)
			for _, done := range completed {
				if !done {
					t.Fatal("new Sync journal has an unfinished transaction")
				}
			}
		}
	}
	if operationJournals != 1 {
		t.Fatalf("operation journals = %d, want 1", operationJournals)
	}
}

func TestCompletedCopySyncJournalIsRecognizedWithoutAdoptingTarget(t *testing.T) {
	l := fixture(t)
	mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "payload"})
	runSyncCompletionChild(t, l, "copy")
	target := filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll")
	content(t, target, "payload")
	must(t, recoverSyncIntent(l))
	must(t, CheckNoPendingSync(l))
	state, err := LoadState(l)
	must(t, err)
	if len(state.Artifacts) != 1 {
		t.Fatalf("successful copy state missing after restart: %+v", state)
	}
	owned, err := liveObjectMatches(l, state.Artifacts[0], target)
	must(t, err)
	if owned {
		t.Fatal("restart adopted a copied target without a live ownership pin")
	}
}

func TestRestartedNonEmptySyncUsesAuthenticatedOwnershipReceipt(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "payload"})
	runSyncCompletionChild(t, l, "copy")

	if _, err := Sync(context.Background(), l, []models.Mod{m}, nil); err != nil {
		t.Fatalf("ordinary Sync after restart failed: %v", err)
	}
	target := filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll")
	content(t, target, "payload")
	state, err := LoadState(l)
	must(t, err)
	if len(state.Artifacts) != 1 || state.Artifacts[0].FileID == "" || state.Artifacts[0].Receipt == "" {
		t.Fatalf("deployed state has no authenticated ownership receipt: %+v", state.Artifacts)
	}
}

func TestRestartedSyncRejectsSameByteReplacementWithInvalidReceipt(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "payload"})
	runSyncCompletionChild(t, l, "copy")
	target := filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll")
	must(t, os.Remove(target))
	write(t, target, "payload")

	_, err := Sync(context.Background(), l, []models.Mod{m}, nil)
	code(t, err, "FileCollision")
	content(t, target, "payload")
	state, err := LoadState(l)
	must(t, err)
	if len(state.Artifacts) != 1 || state.Artifacts[0].Receipt == "" {
		t.Fatalf("conflict discarded ownership evidence: %+v", state.Artifacts)
	}
}

func TestSyncPreservesSameTokenIntentReplacementAfterProcessKill(t *testing.T) {
	l := fixture(t)
	mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "source bytes"})
	killSyncChildAt(t, l, "pre-publication")
	absent(t, filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll"))
	intentPath := l.Paths().SyncIntent
	intentBefore, err := os.ReadFile(intentPath)
	if err != nil {
		t.Fatalf("intent was not durable at pre-publication kill: %v", err)
	}
	must(t, os.Remove(intentPath))
	must(t, os.WriteFile(intentPath, intentBefore, 0600))
	_, err = Sync(context.Background(), l, []models.Mod{{ID: "a", Enabled: true}}, nil)
	code(t, err, "InvalidLibrary")
	absent(t, filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll"))
	intentAfter, err := os.ReadFile(intentPath)
	if err != nil {
		t.Fatalf("intent without a live retirement pin was removed: %v", err)
	}
	if string(intentBefore) != string(intentAfter) {
		t.Fatal("same-token replacement intent was modified")
	}
}

func TestSyncCrashDuringStagingKeepsStageAndBlocksOnItsPath(t *testing.T) {
	l := fixture(t)
	mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "payload"})
	killSyncChildAt(t, l, "during-staging")
	intent, err := readSyncIntentRecords(l.Paths().SyncIntent)
	must(t, err)
	if len(intent) != 1 || len(intent[0].Targets) == 0 {
		t.Fatalf("persisted staging intent = %+v", intent)
	}
	var stage string
	for _, target := range intent[0].Targets {
		if target.Stage != "" {
			stage = filepath.Join(l.GameRoot, target.Stage)
			break
		}
	}
	if stage == "" {
		t.Fatal("copy intent has no deterministic staging path")
	}
	stageBefore, err := os.ReadFile(stage)
	must(t, err)
	for attempt := 0; attempt < 2; attempt++ {
		_, err := Sync(context.Background(), l, []models.Mod{{ID: "a", Enabled: true}}, nil)
		code(t, err, "FileCollision")
		stageAfter, readErr := os.ReadFile(stage)
		must(t, readErr)
		if string(stageAfter) != string(stageBefore) {
			t.Fatal("recovery modified the unproven stage")
		}
	}
}

func TestSyncReconcilesAuthenticatedIntentWhenTargetAndStageAreAbsent(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "payload"})
	killSyncChildAt(t, l, "pre-publication")
	target := filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll")
	absent(t, target)

	for attempt := 0; attempt < 2; attempt++ {
		if _, err := Sync(context.Background(), l, []models.Mod{m}, nil); err != nil {
			t.Fatalf("Sync after absent-target recovery attempt %d failed: %v", attempt+1, err)
		}
		content(t, target, "payload")
	}
}

func TestSyncPreservesSameByteReplacementAfterPublicationCrash(t *testing.T) {
	l := fixture(t)
	mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "same bytes"})
	killSyncChildAt(t, l, "post-publication")
	target := filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll")
	if err := os.Remove(target); err != nil {
		t.Fatal(err)
	}
	write(t, target, "same bytes")
	sentinel := filepath.Join(l.GameRoot, "unrelated-sentinel")
	write(t, sentinel, "keep")
	for attempt := 0; attempt < 2; attempt++ {
		_, err := Sync(context.Background(), l, []models.Mod{{ID: "a", Enabled: true}}, nil)
		code(t, err, "FileCollision")
		content(t, target, "same bytes")
		content(t, sentinel, "keep")
		absent(t, l.Paths().Deployment)
		if _, err := os.Lstat(l.Paths().SyncIntent); err != nil {
			t.Fatalf("pending intent was not retained: %v", err)
		}
	}
}

func TestSyncRetainsIntentAfterPostPublicationFailure(t *testing.T) {
	l := fixture(t)
	mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "published bytes"})
	injected := fmt.Errorf("injected post-publication uncertainty")
	_, err := syncWithHooks(context.Background(), l, []models.Mod{{ID: "a", Enabled: true}}, nil, nil, func(boundary string) error {
		if boundary == "post-publication" {
			return injected
		}
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), injected.Error()) {
		t.Fatalf("Sync error = %v, want injected publication failure", err)
	}
	target := filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll")
	content(t, target, "published bytes")
	absent(t, l.Paths().Deployment)
	if _, err := os.Lstat(l.Paths().SyncIntent); err != nil {
		t.Fatalf("intent was cleared after uncertain publication: %v", err)
	}
	_, err = Sync(context.Background(), l, []models.Mod{{ID: "a", Enabled: true}}, nil)
	code(t, err, "FileCollision")
	content(t, target, "published bytes")
}

func TestDeployPreservesPublishedCopyWhenSourceChangedAfterPlanning(t *testing.T) {
	for _, kind := range []linker.ArtifactKind{linker.Copy, linker.Hardlink} {
		t.Run(string(kind), func(t *testing.T) {
			l := fixture(t)
			m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "planned bytes"})
			plan, err := PlanWithKinds([]models.Mod{m}, l, kind, linker.Copy)
			must(t, err)
			source := filepath.Join(l.LibraryRoot, filepath.FromSlash(plan.Artifacts[0].Source))
			write(t, source, "changed after planning")

			err = Deploy(l, plan)
			code(t, err, "FileCollision")
			target := filepath.Join(l.GameRoot, filepath.FromSlash(plan.Artifacts[0].Target))
			content(t, target, "changed after planning")
			absent(t, l.Paths().Deployment)
			if _, err := os.Lstat(l.Paths().SyncIntent); err != nil {
				t.Fatalf("intent was not retained after fingerprint mismatch: %v", err)
			}
			_, err = Sync(context.Background(), l, []models.Mod{{ID: "a", Enabled: true}}, nil)
			code(t, err, "FileCollision")
			content(t, target, "changed after planning")
		})
	}
}

func TestSyncRefusesUnprovenTargetAtPreStateSaveCrash(t *testing.T) {
	l := fixture(t)
	mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "same bytes"})
	killSyncChildAt(t, l, "pre-state-save")
	target := filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll")
	content(t, target, "same bytes")
	if _, err := os.Lstat(l.Paths().Deployment); !os.IsNotExist(err) {
		t.Fatalf("state was saved before pre-state-save boundary: %v", err)
	}
	if _, err := Sync(context.Background(), l, []models.Mod{{ID: "a", Enabled: true}}, nil); err == nil {
		t.Fatal("recovery adopted an object without a live ownership anchor")
	} else {
		code(t, err, "FileCollision")
	}
	content(t, target, "same bytes")
	if _, err := os.Lstat(l.Paths().SyncIntent); err != nil {
		t.Fatalf("unproven target did not retain its intent: %v", err)
	}
}

func TestSyncPreservesStateAndTargetAfterStateSaveCrash(t *testing.T) {
	l := fixture(t)
	mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "same bytes"})
	killSyncChildAt(t, l, "state-saved")
	target := filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll")
	stateBefore, err := os.ReadFile(l.Paths().Deployment)
	must(t, err)
	if err := os.Remove(target); err != nil {
		t.Fatal(err)
	}
	write(t, target, "same bytes")
	for attempt := 0; attempt < 2; attempt++ {
		_, err := Sync(context.Background(), l, []models.Mod{{ID: "a", Enabled: true}}, nil)
		code(t, err, "FileCollision")
		content(t, target, "same bytes")
		stateAfter, readErr := os.ReadFile(l.Paths().Deployment)
		must(t, readErr)
		if string(stateAfter) != string(stateBefore) {
			t.Fatal("recovery changed persisted deployment state")
		}
	}
}

func TestSyncCompletesRecoveryWhenAuthenticatedStateWasCommitted(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "same bytes"})
	killSyncChildAt(t, l, "state-saved")
	target := filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll")
	content(t, target, "same bytes")

	if _, err := Sync(context.Background(), l, []models.Mod{m}, nil); err != nil {
		t.Fatalf("recovery of committed deployment failed: %v", err)
	}
	content(t, target, "same bytes")
	must(t, CheckNoPendingSync(l))
}

func TestStateWriteAndSyncFailuresKeepSyncIncomplete(t *testing.T) {
	for _, failure := range []string{"write", "sync"} {
		t.Run(failure, func(t *testing.T) {
			l := fixture(t)
			mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "payload"})
			injected := fmt.Errorf("injected state %s failure", failure)
			stateWriter := func(l Layout, state DeploymentState) error {
				return writeDeploymentStateWithFileOps(l, state, func(file *os.File, data []byte) error {
					if failure == "write" {
						written, err := file.Write(data[:min(3, len(data))])
						if err != nil {
							return err
						}
						if written != min(3, len(data)) {
							return io.ErrShortWrite
						}
						return injected
					}
					if _, err := file.Write(data); err != nil {
						return err
					}
					return injected
				})
			}
			_, err := syncWithHooksAndStateWriter(context.Background(), l, []models.Mod{{ID: "a", Enabled: true}}, nil, nil, nil, stateWriter)
			if err == nil || !strings.Contains(err.Error(), injected.Error()) {
				t.Fatalf("Sync error = %v, want injected persistence failure", err)
			}
			if _, err := os.Stat(l.Paths().Deployment); err != nil {
				t.Fatalf("uncertain state record was not preserved: %v", err)
			}
			records, err := readSyncIntentRecords(l.Paths().SyncIntent)
			must(t, err)
			if len(records) != 1 || records[0].Completed {
				t.Fatalf("failed state persistence was marked complete: %+v", records)
			}
			content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll"), "payload")
			code(t, CheckNoPendingSync(l), "InvalidLibrary")
		})
	}
}

func TestInterruptedSyncPreservesPresentTargetAndIntentOnRepeatedRecovery(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "source"})
	plan, err := Plan([]models.Mod{m}, l)
	must(t, err)
	statePath := l.Paths().Deployment
	_, err = saveSyncIntent(l, plan, DeploymentState{Artifacts: []DeploymentArtifact{}, CreatedDirs: []string{}}, nil)
	must(t, err)
	must(t, os.WriteFile(statePath, []byte("unrelated persisted state\n"), 0644))
	target := filepath.Join(l.GameRoot, plan.Artifacts[0].Target)
	write(t, target, "identical foreign replacement")

	for attempt := 0; attempt < 2; attempt++ {
		_, err = Sync(context.Background(), l, []models.Mod{m}, nil)
		code(t, err, "InvalidLibrary")
		content(t, target, "identical foreign replacement")
		content(t, statePath, "unrelated persisted state\n")
		if _, statErr := os.Lstat(l.Paths().SyncIntent); statErr != nil {
			t.Fatalf("sync intent was not retained: %v", statErr)
		}
	}
}

func TestInterruptedSyncWithAbsentTargetsPreservesIntentWithoutLivePin(t *testing.T) {
	l := fixture(t)
	libraryRoot, err := filepath.Abs(l.LibraryRoot)
	must(t, err)
	gameRoot, err := filepath.Abs(l.GameRoot)
	must(t, err)
	intentToken, err := token()
	must(t, err)
	intent := syncIntent{Version: syncIntentVersion, Token: intentToken, LibraryRoot: filepath.Clean(libraryRoot), GameRoot: filepath.Clean(gameRoot), Targets: []syncIntentTarget{{Path: "BepInEx/plugins/a.dll"}}}
	f, err := os.Create(l.Paths().SyncIntent)
	must(t, err)
	must(t, toml.NewEncoder(f).Encode(intent))
	must(t, f.Close())
	if err := recoverSyncIntent(l); err == nil {
		t.Fatal("recovery retired an intent without its process-live identity pin")
	} else {
		code(t, err, "InvalidLibrary")
	}
	if _, err := os.Lstat(l.Paths().SyncIntent); err != nil {
		t.Fatalf("unproven intent was removed: %v", err)
	}
}

func TestSyncIntentJournalRejectsSameTokenReplacement(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "source"})
	plan, err := Plan([]models.Mod{m}, l)
	must(t, err)
	token, err := saveSyncIntent(l, plan, DeploymentState{Artifacts: []DeploymentArtifact{}, CreatedDirs: []string{}}, nil)
	must(t, err)
	path := l.Paths().SyncIntent
	record, err := os.ReadFile(path)
	must(t, err)
	must(t, os.Remove(path))
	write(t, path, string(record))

	err = clearSyncIntent(l, token)
	code(t, err, "InvalidLibrary")
	content(t, path, string(record))
}

func TestMissingLiveSyncJournalPathStillBlocksMutation(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "source"})
	plan, err := Plan([]models.Mod{m}, l)
	must(t, err)
	_, err = saveSyncIntent(l, plan, DeploymentState{Artifacts: []DeploymentArtifact{}, CreatedDirs: []string{}}, nil)
	must(t, err)
	must(t, os.Remove(l.Paths().SyncIntent))
	code(t, CheckNoPendingSync(l), "InvalidLibrary")
	code(t, Deploy(l, DeploymentPlan{}), "InvalidLibrary")
}

func TestEmptySyncPreservesUnprovenDeploymentState(t *testing.T) {
	l := fixture(t)
	path := l.Paths().Deployment
	record := []byte("artifacts = []\ncreated_dirs = []\n")
	must(t, os.WriteFile(path, record, 0600))
	if err := Deploy(l, DeploymentPlan{}); err == nil {
		t.Fatal("empty Sync replaced a deployment state file without a live ownership pin")
	}
	content(t, path, string(record))
	absent(t, l.Paths().SyncIntent)
}

func TestSyncPreservesDeploymentStatePathReplacement(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "owned"})
	syncMods(t, l, m)
	path := l.Paths().Deployment
	foreign := []byte("artifacts = []\ncreated_dirs = []\n")
	if err := releaseLiveDeploymentState(l); err != nil {
		t.Fatal(err)
	}
	must(t, os.Remove(path))
	must(t, os.WriteFile(path, foreign, 0600))
	journalBefore, err := os.ReadFile(l.Paths().SyncIntent)
	must(t, err)
	_, err = Sync(context.Background(), l, nil, nil)
	code(t, err, "FileCollision")
	content(t, path, string(foreign))
	journalAfter, err := os.ReadFile(l.Paths().SyncIntent)
	must(t, err)
	if string(journalAfter) != string(journalBefore) {
		t.Fatal("refused Sync changed the completed journal")
	}
}

func TestRegularFileHardlinkPlanPublishesWithoutCopyStage(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "linked"})
	plan, err := PlanWithKinds([]models.Mod{m}, l, linker.Hardlink, linker.Copy)
	must(t, err)
	if len(plan.Artifacts) != 1 || plan.Artifacts[0].Kind != linker.Hardlink {
		t.Fatalf("plan did not contain the requested regular-file hardlink: %+v", plan.Artifacts)
	}
	must(t, Deploy(l, plan))
	source := filepath.Join(l.Paths().Mods, "a/BepInEx/plugins/a.dll")
	target := filepath.Join(l.GameRoot, plan.Artifacts[0].Target)
	sourceInfo, err := os.Stat(source)
	must(t, err)
	targetInfo, err := os.Stat(target)
	must(t, err)
	if !os.SameFile(sourceInfo, targetInfo) {
		t.Fatal("hardlink plan did not publish a hardlink to the regular source")
	}
	intents, err := readSyncIntentRecords(l.Paths().SyncIntent)
	must(t, err)
	if len(intents) != 2 || intents[0].Targets[0].Stage != "" || !intents[1].Completed {
		t.Fatalf("hardlink journal should have an unstaged intent and durable completion: %+v", intents)
	}
}

func TestSyncPublishesPlannedSymlinkWithoutReplacingTargets(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "payload"})
	plan, err := PlanWithKinds([]models.Mod{m}, l, linker.Symlink, linker.Symlink)
	must(t, err)
	if len(plan.Artifacts) != 1 || plan.Artifacts[0].Kind != linker.Symlink {
		t.Fatalf("plan = %+v, want one symlink artifact", plan)
	}
	must(t, Deploy(l, plan))
	target := filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll")
	if _, err := os.Readlink(target); err != nil {
		t.Fatalf("published symlink missing: %v", err)
	}
}

func TestFailedJournalDirectoryFlushKeepsVisibleBlocker(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "source"})
	plan, err := Plan([]models.Mod{m}, l)
	must(t, err)
	libraryRoot, err := filepath.Abs(l.LibraryRoot)
	must(t, err)
	gameRoot, err := filepath.Abs(l.GameRoot)
	must(t, err)
	token, err := token()
	must(t, err)
	intent := syncIntent{Version: syncIntentVersion, Token: token, LibraryRoot: filepath.Clean(libraryRoot), GameRoot: filepath.Clean(gameRoot), Targets: []syncIntentTarget{{Path: plan.Artifacts[0].Target}}}
	data, err := encodeSyncIntentRecord(intent)
	must(t, err)
	flushErr := fmt.Errorf("injected journal directory flush failure")
	err = appendSyncIntentRecordWithFlush(l, l.Paths().SyncIntent, intent, data, func(string) error { return flushErr })
	if err == nil || !strings.Contains(err.Error(), flushErr.Error()) {
		t.Fatalf("journal creation error = %v, want injected flush failure", err)
	}
	if _, err := os.Stat(l.Paths().SyncIntent); err != nil {
		t.Fatalf("failed directory flush removed the visible journal blocker: %v", err)
	}
	code(t, CheckNoPendingSync(l), "InvalidLibrary")
}

func TestCompletedSyncIntentJournalSurvivesAfterProcessPinIsGone(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"BepInEx/plugins/a.dll": "source"})
	plan, err := Plan([]models.Mod{m}, l)
	must(t, err)
	token, err := saveSyncIntent(l, plan, DeploymentState{Artifacts: []DeploymentArtifact{}, CreatedDirs: []string{}}, nil)
	must(t, err)
	must(t, clearSyncIntent(l, token))
	must(t, CheckNoPendingSync(l)) // the current process can verify its completed journal record.

	key := syncJournalKey(l.Paths().SyncIntent)
	liveSyncJournals.Lock()
	journal := liveSyncJournals.byPath[key]
	delete(liveSyncJournals.byPath, key)
	liveSyncJournals.Unlock()
	if journal == nil || journal.object == nil || journal.file == nil {
		t.Fatal("Sync journal did not retain its original live object handles")
	}
	must(t, journal.object.close())
	must(t, journal.file.Close())

	must(t, recoverSyncIntent(l))
	must(t, CheckNoPendingSync(l))
	if journal := liveSyncJournalFor(l.Paths().SyncIntent); journal != nil {
		t.Fatal("restart adopted and pinned a completed journal without its prior live identity")
	}
	if _, err := os.Stat(l.Paths().SyncIntent); err != nil {
		t.Fatalf("append-only journal was not preserved: %v", err)
	}
}

func TestRestartedEmptySyncIsNoopAndDoesNotAppendToCompletedJournal(t *testing.T) {
	l := fixture(t)
	runSyncCompletionChild(t, l, "empty")
	journalBefore, err := os.ReadFile(l.Paths().SyncIntent)
	must(t, err)
	must(t, recoverSyncIntent(l))
	report, err := Sync(context.Background(), l, nil, nil)
	must(t, err)
	if report.Deployed != 0 {
		t.Fatalf("empty no-op reported deployed artifacts: %+v", report)
	}
	journalAfter, err := os.ReadFile(l.Paths().SyncIntent)
	must(t, err)
	if string(journalAfter) != string(journalBefore) {
		t.Fatal("empty no-op appended to the restart-unproven Sync journal")
	}
	if _, err := os.Lstat(l.Paths().Deployment); !os.IsNotExist(err) {
		t.Fatalf("empty no-op created deployment state: %v", err)
	}
}

func TestRestartedCompletedJournalReplacementIsRejected(t *testing.T) {
	l := fixture(t)
	runSyncCompletionChild(t, l, "empty")
	path := l.Paths().SyncIntent
	record, err := os.ReadFile(path)
	must(t, err)
	must(t, os.Remove(path))
	must(t, os.WriteFile(path, record, 0600))
	before, err := os.ReadFile(path)
	must(t, err)
	code(t, recoverSyncIntent(l), "InvalidLibrary")
	if journal := liveSyncJournalFor(path); journal != nil {
		t.Fatal("restart pinned a completed journal after only pathname inspection")
	}
	intent := syncIntent{Version: syncIntentVersion, Token: "new-transaction", LibraryRoot: l.LibraryRoot, GameRoot: l.GameRoot, Targets: []syncIntentTarget{}}
	data, err := encodeSyncIntentRecord(intent)
	must(t, err)
	code(t, appendSyncIntentRecord(l, path, intent, data), "InvalidLibrary")
	after, err := os.ReadFile(path)
	must(t, err)
	if string(after) != string(before) {
		t.Fatal("append attempt changed a restart-unproven completed journal")
	}
}

func TestMalformedSyncIntentIsPreserved(t *testing.T) {
	l := fixture(t)
	write(t, l.Paths().SyncIntent, "not = [valid")
	_, err := Sync(context.Background(), l, nil, nil)
	code(t, err, "InvalidLibrary")
	if _, statErr := os.Lstat(l.Paths().SyncIntent); statErr != nil {
		t.Fatalf("malformed intent was removed: %v", statErr)
	}
}

func TestPendingSyncBlocksDirectMutationAndDeletionGuards(t *testing.T) {
	l := fixture(t)
	intentPath := l.Paths().SyncIntent
	write(t, intentPath, "malformed intent remains authoritative")
	state := DeploymentState{Artifacts: []DeploymentArtifact{}, CreatedDirs: []string{}}
	for name, err := range map[string]error{
		"deploy":         Deploy(l, DeploymentPlan{}),
		"purge":          Purge(l, nil),
		"validate purge": ValidatePurge(l),
		"ownership":      VerifyOwnership(l),
		"save state":     SaveState(l, state),
	} {
		t.Run(name, func(t *testing.T) {
			code(t, err, "InvalidLibrary")
			if _, statErr := os.Lstat(intentPath); statErr != nil {
				t.Fatalf("%s removed pending intent: %v", name, statErr)
			}
			content(t, intentPath, "malformed intent remains authoritative")
		})
	}
}

func TestMutationLockSerializesIndependentCallers(t *testing.T) {
	l := fixture(t)
	releaseFirst, err := acquireMutationLock(l)
	must(t, err)
	started := make(chan struct{})
	acquired := make(chan func(), 1)
	failed := make(chan error, 1)
	go func() {
		close(started)
		release, lockErr := acquireMutationLock(l)
		if lockErr != nil {
			failed <- lockErr
			return
		}
		acquired <- release
	}()
	<-started
	select {
	case release := <-acquired:
		release()
		releaseFirst()
		t.Fatal("independent mutation acquired the lock before the owner released it")
	case err := <-failed:
		releaseFirst()
		t.Fatal(err)
	case <-time.After(50 * time.Millisecond):
	}
	releaseFirst()
	select {
	case release := <-acquired:
		release()
	case err := <-failed:
		t.Fatal(err)
	case <-time.After(2 * time.Second):
		t.Fatal("waiting mutation did not acquire the released lock")
	}
}

func TestMutationLockSerializesLibrariesSharingGameRoot(t *testing.T) {
	l := fixture(t)
	otherLibrary := filepath.Join(t.TempDir(), "other-library")
	must(t, os.MkdirAll(otherLibrary, 0o755))
	other := Layout{LibraryRoot: otherLibrary, GameRoot: l.GameRoot}
	releaseFirst, err := acquireMutationLock(l)
	must(t, err)
	started := make(chan struct{})
	acquired := make(chan func(), 1)
	failed := make(chan error, 1)
	go func() {
		close(started)
		release, lockErr := acquireMutationLock(other)
		if lockErr != nil {
			failed <- lockErr
			return
		}
		acquired <- release
	}()
	<-started
	select {
	case release := <-acquired:
		release()
		releaseFirst()
		t.Fatal("different library acquired a shared-game lock before release")
	case err := <-failed:
		releaseFirst()
		t.Fatal(err)
	case <-time.After(50 * time.Millisecond):
	}
	releaseFirst()
	select {
	case release := <-acquired:
		release()
	case err := <-failed:
		t.Fatal(err)
	case <-time.After(2 * time.Second):
		t.Fatal("shared-game mutation did not acquire the released lock")
	}
}

func TestSyncPreflightsChangedRemovalsBeforePurgingRecordedLinks(t *testing.T) {
	testSyncPreflightsChangedRemovalsBeforePurgingRecordedLinks(t)
}

func TestSyncRefusesRedirectedRecordedDirectoriesWhenArtifactsAreMissing(t *testing.T) {
	testSyncRefusesRedirectedRecordedDirectoriesWhenArtifactsAreMissing(t)
}

func TestUpdatingADeployedModRefreshesAndRemovalUnlinksStaleCopies(t *testing.T) {
	testUpdatingADeployedModRefreshesAndRemovalUnlinksStaleCopies(t)
}

func TestCopyDeploymentReusesOwnedDirectoriesAndNormalizesLegacyPaths(t *testing.T) {
	testCopyDeploymentReusesOwnedDirectoriesAndNormalizesLegacyPaths(t)
}

func TestLegacyCopyDeploymentFingerprintsAreNotAdoptedOnLoad(t *testing.T) {
	testLegacyCopyDeploymentFingerprintsAreNotAdoptedOnLoad(t)
}

func TestCopyDeploymentMergesIntoExistingGameDirectory(t *testing.T) {
	testCopyDeploymentMergesIntoExistingGameDirectory(t)
}

func TestUnownedDeploymentTargetIsPreservedAndBlocksSync(t *testing.T) {
	testUnownedDeploymentTargetIsPreservedAndBlocksSync(t)
}

func TestSyncReportsOneUnmanagedConflictAndDeploysOtherMod(t *testing.T) {
	l := fixture(t)
	conflict := mod(t, l, "conflict", map[string]string{"BepInEx/plugins/Conflict/conflict.dll": "mod"})
	success := mod(t, l, "success", map[string]string{"BepInEx/plugins/Success/success.dll": "good"})
	conflictingTarget := filepath.Join(l.GameRoot, "BepInEx/plugins/Conflict/conflict.dll")
	write(t, conflictingTarget, "unmanaged")

	report, err := Sync(context.Background(), l, []models.Mod{conflict, success}, nil)
	if err != nil {
		t.Fatalf("Sync() error = %v; want per-mod conflict report", err)
	}
	if len(report.Failures) != 1 || report.Failures[0].ModID != conflict.ID {
		t.Fatalf("failures = %#v; want only mod %q", report.Failures, conflict.ID)
	}
	if report.Deployed != 1 {
		t.Fatalf("deployed = %d; want 1", report.Deployed)
	}
	content(t, conflictingTarget, "unmanaged")
	content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/Success/success.dll"), "good")
	if _, err := os.Lstat(filepath.Join(l.GameRoot, "BepInEx/plugins/Conflict/conflict.dll")); err != nil {
		t.Fatalf("unmanaged conflict was removed: %v", err)
	}
}

func TestSyncExcludesEveryOwnerOfDuplicateTargetAndDeploysIndependentMods(t *testing.T) {
	for _, order := range []string{"abc", "cba"} {
		t.Run(order, func(t *testing.T) {
			l := fixture(t)
			a := mod(t, l, "a", map[string]string{"BepInEx/plugins/Shared/shared.dll": "a"})
			b := mod(t, l, "b", map[string]string{"BepInEx/plugins/Shared/shared.dll": "b"})
			c := mod(t, l, "c", map[string]string{"BepInEx/plugins/Independent/independent.dll": "c"})
			sentinel := filepath.Join(l.GameRoot, "BepInEx/plugins/User/keep.bin")
			write(t, sentinel, "unmanaged sentinel")
			before, err := os.ReadFile(sentinel)
			if err != nil {
				t.Fatal(err)
			}
			mods := []models.Mod{a, b, c}
			if order == "cba" {
				mods = []models.Mod{c, b, a}
			}

			report, err := Sync(context.Background(), l, mods, nil)
			if err != nil {
				t.Fatalf("Sync() error = %v, want partial result", err)
			}
			if len(report.Failures) != 2 || report.Failures[0].ModID != "a" || report.Failures[1].ModID != "b" {
				t.Fatalf("failures = %#v, want a and b once in ID order", report.Failures)
			}
			if report.Deployed != 1 {
				t.Fatalf("deployed = %d, want independent mod only", report.Deployed)
			}
			if _, err := os.Lstat(filepath.Join(l.GameRoot, "BepInEx/plugins/Shared/shared.dll")); !os.IsNotExist(err) {
				t.Fatalf("conflicting target exists or could not be checked: %v", err)
			}
			content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/Independent/independent.dll"), "c")
			after, err := os.ReadFile(sentinel)
			if err != nil || !bytes.Equal(after, before) {
				t.Fatalf("unmanaged sentinel changed: before=%q after=%q err=%v", before, after, err)
			}
			state, err := LoadState(l)
			if err != nil {
				t.Fatal(err)
			}
			if len(state.Artifacts) != 1 || state.Artifacts[0].Source != filepath.Join("mods", "c", "BepInEx", "plugins", "Independent", "independent.dll") {
				t.Fatalf("deployment state = %#v, want only mod c artifact", state.Artifacts)
			}
		})
	}
}

func TestSyncExcludesFileDirectoryAncestorConflictsAndKeepsSharedDirectories(t *testing.T) {
	t.Run("file directory ancestor", func(t *testing.T) {
		l := fixture(t)
		a := mod(t, l, "a", map[string]string{"BepInEx/plugins/Shared": "file"})
		b := mod(t, l, "b", map[string]string{"BepInEx/plugins/Shared/child.dll": "child"})
		c := mod(t, l, "c", map[string]string{"BepInEx/plugins/Other/other.dll": "independent"})
		report, err := Sync(context.Background(), l, []models.Mod{b, c, a}, nil)
		if err != nil {
			t.Fatalf("Sync() error = %v, want independent partial deployment", err)
		}
		if len(report.Failures) != 2 || report.Failures[0].ModID != "a" || report.Failures[1].ModID != "b" || report.Deployed != 1 {
			t.Fatalf("report = %+v, want a and b failed and c deployed", report)
		}
		absent(t, filepath.Join(l.GameRoot, "BepInEx/plugins/Shared"))
		content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/Other/other.dll"), "independent")
	})

	t.Run("shared directories are not conflicts", func(t *testing.T) {
		l := fixture(t)
		a := mod(t, l, "a", map[string]string{"BepInEx/plugins/Shared/a.dll": "a"})
		b := mod(t, l, "b", map[string]string{"BepInEx/plugins/Shared/b.dll": "b"})
		report, err := Sync(context.Background(), l, []models.Mod{b, a}, nil)
		if err != nil || len(report.Failures) != 0 || report.Deployed != 2 {
			t.Fatalf("report=%+v error=%v, want both shared-directory claims deployed", report, err)
		}
		content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/Shared/a.dll"), "a")
		content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/Shared/b.dll"), "b")
	})
}

func TestSyncExcludesAllModsInMultipleAndMappedDestinationConflicts(t *testing.T) {
	t.Run("multiple conflicts", func(t *testing.T) {
		l := fixture(t)
		a := mod(t, l, "a", map[string]string{
			"BepInEx/plugins/One/one.dll": "a1",
			"BepInEx/plugins/Two/two.dll": "a2",
		})
		b := mod(t, l, "b", map[string]string{"BepInEx/plugins/One/one.dll": "b"})
		c := mod(t, l, "c", map[string]string{"BepInEx/plugins/Two/two.dll": "c"})
		d := mod(t, l, "d", map[string]string{"BepInEx/plugins/Independent/d.dll": "d"})
		report, err := Sync(context.Background(), l, []models.Mod{d, c, a, b}, nil)
		if err != nil || len(report.Failures) != 3 || report.Deployed != 1 {
			t.Fatalf("report=%+v error=%v, want a/b/c failed and d deployed", report, err)
		}
		for i, id := range []string{"a", "b", "c"} {
			if report.Failures[i].ModID != id {
				t.Fatalf("failures = %#v, want IDs sorted", report.Failures)
			}
		}
		content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/Independent/d.dll"), "d")
	})

	t.Run("mapped unmanaged destination", func(t *testing.T) {
		l := fixture(t)
		l.Rules.ServerExe = filepath.Join("SPT_Runtime", "SPT.Server.exe")
		a := mod(t, l, "a", map[string]string{"SPT/user/mods/Mapped/file.dll": "a"})
		c := mod(t, l, "c", map[string]string{"BepInEx/plugins/Independent/c.dll": "c"})
		mappedTarget := filepath.Join(l.GameRoot, "SPT_Runtime/user/mods/Mapped/file.dll")
		write(t, mappedTarget, "unmanaged mapped target")
		report, err := Sync(context.Background(), l, []models.Mod{a, c}, nil)
		if err != nil || len(report.Failures) != 1 || report.Failures[0].ModID != "a" || report.Deployed != 1 {
			t.Fatalf("report=%+v error=%v, want mapped owner failed and c deployed", report, err)
		}
		content(t, mappedTarget, "unmanaged mapped target")
		content(t, filepath.Join(l.GameRoot, "BepInEx/plugins/Independent/c.dll"), "c")
	})
}

func TestSyncWithOnlyConflictingModsKeepsFailureBehavior(t *testing.T) {
	l := fixture(t)
	a := mod(t, l, "a", map[string]string{"BepInEx/plugins/Shared/a.dll": "a"})
	b := mod(t, l, "b", map[string]string{"BepInEx/plugins/Shared/a.dll": "b"})
	_, err := Sync(context.Background(), l, []models.Mod{b, a}, nil)
	code(t, err, models.FileCollision)
	state, err := LoadState(l)
	if err != nil || len(state.Artifacts) != 0 {
		t.Fatalf("state=%+v error=%v, want no deployment", state, err)
	}
}

func TestSyncRefusesPartialReconciliationWhenExcludedModsHavePriorArtifacts(t *testing.T) {
	l := fixture(t)
	a := mod(t, l, "a", map[string]string{"BepInEx/plugins/Old/a.dll": "a"})
	b := mod(t, l, "b", map[string]string{"BepInEx/plugins/Old/b.dll": "b"})
	c := mod(t, l, "c", map[string]string{"BepInEx/plugins/Independent/c.dll": "c"})
	syncMods(t, l, a, b, c)
	stateBefore, err := os.ReadFile(l.Paths().Deployment)
	if err != nil {
		t.Fatal(err)
	}
	aConflict := filepath.Join(l.Paths().Mods, "a", "BepInEx", "plugins", "Shared", "same.dll")
	bConflict := filepath.Join(l.Paths().Mods, "b", "BepInEx", "plugins", "Shared", "same.dll")
	write(t, aConflict, "a conflict")
	write(t, bConflict, "b conflict")
	sentinel := filepath.Join(l.GameRoot, "BepInEx", "plugins", "User", "sentinel.bin")
	write(t, sentinel, "unmanaged")
	_, err = Sync(context.Background(), l, []models.Mod{a, b, c}, nil)
	if err == nil {
		t.Fatal("Sync() succeeded, want conservative pre-mutation refusal")
	}
	for _, deployed := range []struct{ path, value string }{
		{filepath.Join(l.GameRoot, "BepInEx", "plugins", "Old", "a.dll"), "a"},
		{filepath.Join(l.GameRoot, "BepInEx", "plugins", "Old", "b.dll"), "b"},
		{filepath.Join(l.GameRoot, "BepInEx", "plugins", "Independent", "c.dll"), "c"},
		{sentinel, "unmanaged"},
	} {
		content(t, deployed.path, deployed.value)
	}
	stateAfter, err := os.ReadFile(l.Paths().Deployment)
	if err != nil || string(stateAfter) != string(stateBefore) {
		t.Fatalf("deployment state changed: before=%q after=%q err=%v", stateBefore, stateAfter, err)
	}
}

func TestUntrackedFileSafetyInSharedFolder(t *testing.T) {
	testUntrackedFileSafetyInSharedFolder(t)
}

func TestRecursiveLinkingLogic(t *testing.T) {
	testRecursiveDeploymentLogic(t)
}

func TestReloadingALibraryRefreshesDeployStale(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "v1"})
	syncMods(t, l, m)
	write(t, filepath.Join(l.Paths().Mods, "a/SPT/user/mods/A/file"), "v2")
	stale, err := DeployStale(l, []models.Mod{m})
	must(t, err)
	if !stale {
		t.Fatal("expected deployment to be stale after the source tree changed")
	}
}
