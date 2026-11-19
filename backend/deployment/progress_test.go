package deployment

import (
	"context"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/task_progress"
	"os"
	"testing"
)

func TestSyncProgressStages(t *testing.T) {
	l := fixture(t)
	m := mod(t, l, "a", map[string]string{"SPT/user/mods/A/file": "a"})
	var stages []models.TaskProgressStage
	emitter := task_progress.New("task", "library", models.TaskOperationSync, func(event models.TaskProgressEvent) error {
		stages = append(stages, event.Stage)
		if event.Stage == models.TaskStageSyncPersist {
			if _, err := os.Lstat(l.Paths().Deployment); !os.IsNotExist(err) {
				t.Fatal("persist reported after deployment record was written")
			}
		}
		return nil
	})
	_, e := Sync(context.Background(), l, []models.Mod{m}, emitter)
	must(t, e)
	want := []models.TaskProgressStage{models.TaskStageSyncPlan, models.TaskStageSyncPreflight, models.TaskStageSyncCleanup, models.TaskStageSyncDeploy, models.TaskStageSyncPersist}
	if len(stages) != len(want) {
		t.Fatal(stages)
	}
	for i, s := range want {
		if stages[i] != s {
			t.Fatal(stages)
		}
	}
}
func TestSyncCancellationBeforeMutation(t *testing.T) {
	l := fixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, e := Sync(ctx, l, nil, nil)
	if e != context.Canceled {
		t.Fatal(e)
	}
	absent(t, l.Paths().Deployment)
}
func TestPreflightRejectsLateUnownedTargetBeforeRemovingOldCopies(t *testing.T) {
	l := fixture(t)
	old := mod(t, l, "old", map[string]string{"SPT/user/mods/Old/file": "old"})
	syncMods(t, l, old)
	next := mod(t, l, "next", map[string]string{"SPT/user/mods/Next/file": "next"})
	plan, e := Plan([]models.Mod{next}, l)
	must(t, e)
	write(t, l.GameRoot+"/SPT/user/mods/Next/file", "user")
	code(t, Deploy(l, plan), "FileCollision")
	content(t, l.GameRoot+"/SPT/user/mods/Old/file", "old")
	content(t, l.GameRoot+"/SPT/user/mods/Next/file", "user")
}
