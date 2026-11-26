package task_progress

import (
	"log/slog"
	"math"
	"sync"
	"time"

	"github.com/martes/modkeeper/backend/models"
)

type Outcome uint8

const (
	Success Outcome = iota
	PartialFailure
	Failure
)

type Emitter struct {
	mu                sync.Mutex
	taskID, libraryID string
	operation         models.TaskOperation
	sequence          uint32
	send              func(models.TaskProgressEvent) error
}

func New(taskID, libraryID string, operation models.TaskOperation, send func(models.TaskProgressEvent) error) *Emitter {
	return &Emitter{taskID: taskID, libraryID: libraryID, operation: operation, send: send}
}

// StartAfterAdmission emits no event when admission fails.
func (e *Emitter) StartAfterAdmission(err error) error {
	if err != nil {
		return err
	}
	e.emit(models.TaskProgressStarted, models.TaskStageTaskStarted, nil, nil)
	return nil
}

func (e *Emitter) Progress(stage models.TaskProgressStage, percent *float64) {
	var valid *float64
	if percent != nil && !math.IsNaN(*percent) && !math.IsInf(*percent, 0) {
		p := math.Max(0, math.Min(100, *percent))
		valid = &p
	}
	e.emit(models.TaskProgressProgress, stage, valid, nil)
}

func (e *Emitter) Completed(outcome Outcome) {
	stage, level, code, message := models.TaskStageTaskCompleted, models.TaskLevelInfo, "task_completed", "Operation completed"
	switch outcome {
	case PartialFailure:
		stage, level, code, message = models.TaskStageTaskPartialFailure, models.TaskLevelWarn, "task_partial_failure", "Operation completed with some failures"
	case Failure:
		stage, level, code, message = models.TaskStageTaskFailed, models.TaskLevelError, "task_failed", "Operation failed"
	}
	e.emit(models.TaskProgressCompleted, stage, nil, &models.TaskProgressLog{Level: level, Code: code, Message: message})
}

// Failed keeps diagnostic causes in the developer log, not progress events.
func (e *Emitter) Failed(err error) {
	slog.Error("task failed", "operation", e.operation, "task_id", e.taskID, "error", err)
	e.Completed(Failure)
}

func (e *Emitter) Cancelled() {
	e.emit(models.TaskProgressCompleted, models.TaskStageTaskCancelled, nil,
		&models.TaskProgressLog{Level: models.TaskLevelInfo, Code: "task_cancelled", Message: "Operation cancelled"})
}

func (e *Emitter) emit(kind models.TaskProgressKind, stage models.TaskProgressStage, percent *float64, log *models.TaskProgressLog) {
	e.mu.Lock()
	e.sequence++
	event := models.TaskProgressEvent{TaskID: e.taskID, LibraryID: e.libraryID, Operation: e.operation, Sequence: e.sequence, Kind: kind, Stage: stage, Percent: percent, Log: log}
	if e.send != nil {
		_ = e.send(event)
	}
	e.mu.Unlock()
}

func ArchiveCountPercent(completed, total int) *float64 {
	if total == 0 {
		return nil
	}
	p := math.Max(0, math.Min(100, float64(completed)*100/float64(total)))
	return &p
}

func ArchiveOutcome(failures, total int) Outcome {
	if failures <= 0 {
		return Success
	}
	if failures < total {
		return PartialFailure
	}
	return Failure
}

type ByteThrottle struct {
	total uint64
	last  *float64
	at    time.Time
}

func NewByteThrottle(total uint64) *ByteThrottle { return &ByteThrottle{total: total} }
func (t *ByteThrottle) Update(read uint64, now time.Time, force bool) *float64 {
	if t.total == 0 {
		return nil
	}
	p := math.Max(0, math.Min(100, float64(read)*100/float64(t.total)))
	if !force && t.last != nil && math.Abs(p-*t.last) < 1 && now.Sub(t.at) < 100*time.Millisecond {
		return nil
	}
	t.last, t.at = &p, now
	return &p
}
