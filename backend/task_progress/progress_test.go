package task_progress

import (
	"encoding/json"
	"math"
	"testing"
	"time"

	"github.com/martes/modkeeper/backend/models"
)

func TestAdmissionOrderingAndSinkFailure(t *testing.T) {
	var events []models.TaskProgressEvent
	e := New("t", "l", models.TaskOperationInstall, func(v models.TaskProgressEvent) error { events = append(events, v); return nil })
	if e.StartAfterAdmission(assertErr{}) == nil {
		t.Fatal("admission error lost")
	}
	if len(events) != 0 {
		t.Fatal("rejected admission emitted")
	}
	if err := e.StartAfterAdmission(nil); err != nil {
		t.Fatal(err)
	}
	p := 50.0
	e.Progress(models.TaskStageInstallArchives, &p)
	e.Completed(Success)
	if len(events) != 3 || events[0].Sequence != 1 || events[2].Sequence != 3 || events[2].Stage != models.TaskStageTaskCompleted {
		t.Fatalf("bad order: %#v", events)
	}
	b, err := json.Marshal(events[0])
	if err != nil {
		t.Fatal(err)
	}
	var shape map[string]any
	_ = json.Unmarshal(b, &shape)
	if shape["percent"] != nil || shape["log"] != nil {
		t.Fatalf("nullable fields omitted: %s", b)
	}
}

type assertErr struct{}

func (assertErr) Error() string { return "denied" }

func TestPercentagesAndArchiveOutcome(t *testing.T) {
	if ArchiveCountPercent(1, 4) == nil || *ArchiveCountPercent(1, 4) != 25 {
		t.Fatal("count percent")
	}
	if ArchiveCountPercent(0, 0) != nil {
		t.Fatal("empty total should be indeterminate")
	}
	if ArchiveOutcome(1, 4) != PartialFailure || ArchiveOutcome(4, 4) != Failure || ArchiveOutcome(0, 4) != Success {
		t.Fatal("outcome")
	}
	var es []models.TaskProgressEvent
	e := New("t", "l", models.TaskOperationSync, func(v models.TaskProgressEvent) error { es = append(es, v); return assertErr{} })
	e.StartAfterAdmission(nil)
	nan := math.NaN()
	e.Progress(models.TaskStageSyncPlan, &nan)
	e.Completed(Failure)
	if len(es) != 3 || es[1].Percent != nil || es[2].Log.Code != "task_failed" {
		t.Fatal(es)
	}
}

func TestByteThrottle(t *testing.T) {
	now := time.Now()
	th := NewByteThrottle(1000)
	if p := th.Update(100, now, false); p == nil || *p != 10 {
		t.Fatal(p)
	}
	if p := th.Update(105, now.Add(50*time.Millisecond), false); p != nil {
		t.Fatal(p)
	}
	if p := th.Update(105, now.Add(100*time.Millisecond), false); p == nil || *p != 10.5 {
		t.Fatal(p)
	}
	if NewByteThrottle(0).Update(1, now, true) != nil {
		t.Fatal("zero total")
	}
}
