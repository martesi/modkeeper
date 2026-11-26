package library

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/deployment"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/process"
)

func TestSyncPersistsDirtyBeforeCleanupAndClearsAfterSuccess(t *testing.T) {
	_, svc := deleteFixture(t)
	svc.Inspector = process.Fake{}
	id := svc.active.manifest.ID
	svc.active.manifest.IsDirty = false
	if err := svc.active.Persist(); err != nil {
		t.Fatal(err)
	}
	var sawCleanup, dirtyAtCleanup bool
	_, err := svc.SyncMods(models.SyncModsInput{TaskID: "sync-dirty", LibraryID: id}, func(event models.TaskProgressEvent) error {
		if event.Stage == models.TaskStageSyncCleanup {
			sawCleanup = true
			var saved manifest
			if _, err := toml.DecodeFile(filepath.Join(svc.active.Root, "manifest.toml"), &saved); err != nil {
				return err
			}
			dirtyAtCleanup = saved.IsDirty
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	svc.Wait()
	if !sawCleanup || !dirtyAtCleanup {
		t.Fatalf("cleanup observed=%v persisted dirty=%v", sawCleanup, dirtyAtCleanup)
	}
	var saved manifest
	if _, err := toml.DecodeFile(filepath.Join(svc.active.Root, "manifest.toml"), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.IsDirty {
		t.Fatal("successful sync left manifest dirty")
	}
}

func TestSyncPersistenceFailuresEmitCompletion(t *testing.T) {
	for _, phase := range []string{"initial", "final"} {
		for _, initiallyDirty := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/dirty=%v", phase, initiallyDirty), func(t *testing.T) {
				env, svc, layout, _ := deployedFixture(t)
				svc.Inspector = process.Fake{}
				if err := deployment.Purge(layout, nil); err != nil {
					t.Fatal(err)
				}
				if _, err := svc.SyncMods(models.SyncModsInput{TaskID: "setup", LibraryID: svc.active.manifest.ID}, nil); err != nil {
					t.Fatal(err)
				}
				svc.Wait()
				if _, err := os.Stat(deployedFile(t, env, layout)); err != nil {
					t.Fatalf("setup deployment: %v", err)
				}
				svc.active.manifest.IsDirty = initiallyDirty
				if err := svc.active.Persist(); err != nil {
					t.Fatal(err)
				}
				cache := filepath.Join(svc.active.Root, "cache.toml")
				breakCache := func() {
					if err := os.Remove(cache); err != nil {
						t.Error(err)
						return
					}
					if err := os.Mkdir(cache, 0755); err != nil {
						t.Error(err)
					}
				}
				if phase == "initial" {
					breakCache()
				}
				var events []models.WorkspaceEvent
				var progress []models.TaskProgressEvent
				svc.SetEventSenders(nil, func(event models.WorkspaceEvent) error { events = append(events, event); return nil })
				_, err := svc.SyncMods(models.SyncModsInput{TaskID: "sync-failure", LibraryID: svc.active.manifest.ID}, func(event models.TaskProgressEvent) error {
					progress = append(progress, event)
					if phase == "final" && event.Stage == models.TaskStageSyncPersist {
						breakCache()
					}
					return nil
				})
				if err != nil {
					t.Fatal(err)
				}
				svc.Wait()
				if len(events) != 1 || events[0].Type != models.WorkspaceEventSyncCompleted {
					t.Fatalf("completion events: %#v", events)
				}
				wantCause := models.SyncCauseInitialPersistence
				if phase == "final" {
					wantCause = models.SyncCauseFinalPersistence
				}
				if events[0].Status != models.SyncFailure || events[0].Cause != wantCause {
					t.Fatalf("wrong completion: %+v", events[0])
				}
				if len(events[0].Workspace.Libraries) != 1 || events[0].Workspace.Libraries[0].Summary == nil || !events[0].Workspace.Libraries[0].Summary.DeployStale {
					t.Fatalf("completion snapshot is not dirty: %#v", events[0].Workspace.Libraries)
				}
				if len(progress) == 0 || progress[len(progress)-1].Log == nil {
					t.Fatalf("missing diagnostic: %#v", progress)
				}
				if progress[len(progress)-1].Log.Message != "Operation failed" {
					t.Fatalf("unsafe progress message: %s", progress[len(progress)-1].Log.Message)
				}
				payload, err := json.Marshal(struct {
					Progress  []models.TaskProgressEvent
					Workspace []models.WorkspaceEvent
				}{progress, events})
				if err != nil {
					t.Fatal(err)
				}
				if strings.Contains(string(payload), cache) {
					t.Fatalf("private error path in events: %s", payload)
				}
				var saved manifest
				if _, err := toml.DecodeFile(filepath.Join(svc.active.Root, "manifest.toml"), &saved); err != nil {
					t.Fatal(err)
				}
				if phase == "final" && !saved.IsDirty {
					t.Fatal("failed final persistence left disk manifest clean")
				}
				if !svc.active.manifest.IsDirty {
					t.Fatal("failure left memory clean")
				}
				if _, err := os.Stat(deployedFile(t, env, layout)); err != nil {
					t.Fatalf("deployed artifact missing: %v", err)
				}
			})
		}
	}
}

func TestPersistCacheFailureDoesNotReplaceDirtyManifest(t *testing.T) {
	_, svc := deleteFixture(t)
	svc.active.manifest.IsDirty = true
	if err := svc.active.Persist(); err != nil {
		t.Fatal(err)
	}
	cache := filepath.Join(svc.active.Root, "cache.toml")
	if err := os.Remove(cache); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(cache, 0755); err != nil {
		t.Fatal(err)
	}
	svc.active.manifest.IsDirty = false
	if err := svc.active.Persist(); err == nil {
		t.Fatal("expected cache save failure")
	}
	var saved manifest
	if _, err := toml.DecodeFile(filepath.Join(svc.active.Root, "manifest.toml"), &saved); err != nil {
		t.Fatal(err)
	}
	if !saved.IsDirty {
		t.Fatal("cache failure replaced the dirty manifest")
	}
}

func TestCancelledSyncLeavesManifestDirty(t *testing.T) {
	for _, stage := range []models.TaskProgressStage{models.TaskStageSyncCleanup, models.TaskStageSyncPersist} {
		t.Run(string(stage), func(t *testing.T) {
			_, svc := deleteFixture(t)
			svc.Inspector = process.Fake{}
			id := svc.active.manifest.ID
			svc.active.manifest.IsDirty = false
			if err := svc.active.Persist(); err != nil {
				t.Fatal(err)
			}
			var cancelErr error
			var events []models.WorkspaceEvent
			var progress []models.TaskProgressEvent
			svc.SetEventSenders(nil, func(event models.WorkspaceEvent) error { events = append(events, event); return nil })
			_, err := svc.SyncMods(models.SyncModsInput{TaskID: "sync-cancel", LibraryID: id}, func(event models.TaskProgressEvent) error {
				progress = append(progress, event)
				if event.Stage == stage {
					cancelErr = svc.Registry.CancelTask("sync-cancel", id)
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			svc.Wait()
			if cancelErr != nil {
				t.Fatal(cancelErr)
			}
			var saved manifest
			if _, err := toml.DecodeFile(filepath.Join(svc.active.Root, "manifest.toml"), &saved); err != nil {
				t.Fatal(err)
			}
			if !saved.IsDirty || !svc.active.manifest.IsDirty {
				t.Fatal("cancelled sync did not remain dirty on disk and in memory")
			}
			if len(events) != 1 || events[0].Type != models.WorkspaceEventSyncCompleted || events[0].Status != models.SyncCancelled || progress[len(progress)-1].Stage != models.TaskStageTaskCancelled {
				t.Fatalf("cancelled sync did not emit terminal events: %#v %#v", events, progress)
			}
		})
	}
}

func TestSyncDiscoveryFailureCompletes(t *testing.T) {
	_, svc := deleteFixture(t)
	svc.Inspector = process.Fake{}
	invalidRoot := t.TempDir()
	for _, dir := range []string{"SPT", "SPT_Runtime"} {
		path := filepath.Join(invalidRoot, dir, "SPT.Server.exe")
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, nil, 0644); err != nil {
			t.Fatal(err)
		}
	}
	var events []models.WorkspaceEvent
	var progress []models.TaskProgressEvent
	svc.SetEventSenders(nil, func(event models.WorkspaceEvent) error { events = append(events, event); return nil })
	if _, err := svc.SyncMods(models.SyncModsInput{TaskID: "discovery", LibraryID: svc.active.manifest.ID}, func(event models.TaskProgressEvent) error {
		progress = append(progress, event)
		if event.Stage == models.TaskStageTaskStarted {
			svc.active.GameRoot = invalidRoot
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	svc.Wait()
	if len(events) != 1 || events[0].Status != models.SyncFailure || events[0].Cause != models.SyncCauseDiscovery || len(progress) == 0 || progress[len(progress)-1].Stage != models.TaskStageTaskFailed {
		t.Fatalf("events=%+v progress=%+v", events, progress)
	}
}
