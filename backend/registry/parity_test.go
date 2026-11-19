package registry

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/process"
)

func TestStartupLibraryWaitsForBackgroundLoadCompletion(t *testing.T) {
	r := NewTaskRegistry()
	done := make(chan error, 1)
	go func() { done <- r.WaitForStartupLoad(context.Background()) }()
	select {
	case err := <-done:
		t.Fatalf("returned before startup completed: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	r.FinishStartupLoad(nil)
	if err := <-done; err != nil {
		t.Fatalf("wait: %v", err)
	}
	r = NewTaskRegistry()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := r.WaitForStartupLoad(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation: %v", err)
	}
	want := errors.New("startup failed")
	r.FinishStartupLoad(want)
	if err := r.WaitForStartupLoad(context.Background()); !errors.Is(err, want) {
		t.Fatalf("startup error: %v", err)
	}
}
func TestTestTaskIdInUseRejectedUntilFinished(t *testing.T) {
	r := NewTaskRegistry()
	if err := r.AcquireTaskID("task"); err != nil {
		t.Fatal(err)
	}
	err := r.AcquireTaskID("task")
	var coded *models.Error
	if !errors.As(err, &coded) || coded.Code != models.TaskIdInUse {
		t.Fatalf("duplicate error: %v", err)
	}
	r.FinishTaskID("task")
	if err := r.AcquireTaskID("task"); err != nil {
		t.Fatalf("reuse: %v", err)
	}
}
func TestTestAssertActiveLibraryRejectsNonActive(t *testing.T) {
	r := NewTaskRegistry()
	err := r.AssertActiveLibrary("lib")
	var coded *models.Error
	if !errors.As(err, &coded) || coded.Code != models.NoActiveLibrary {
		t.Fatalf("inactive error: %v", err)
	}
	r.SetActive("lib", true)
	err = r.AssertActiveLibrary("other")
	if !errors.As(err, &coded) || coded.Code != models.InvalidLibrary {
		t.Fatalf("wrong-library error: %v", err)
	}
}

type processInspector func() (bool, error)

func processRunning(inspect processInspector) (bool, error) { return inspect() }

func TestInjectedProcessInspectorAssertions(t *testing.T) {
	running, err := processRunning(func() (bool, error) { return true, nil })
	if err != nil || !running {
		t.Fatalf("running process not detected: %v %v", running, err)
	}
	expected := errors.New("Unable to inspect running processes")
	running, err = processRunning(func() (bool, error) { return false, expected })
	if running || !errors.Is(err, expected) {
		t.Fatalf("inspection failure reported safe: %v %v", running, err)
	}
}

func TestTestProcessGuardDetectsRunningProcess(t *testing.T) {
	for _, code := range []string{models.GameOrServerRunning, models.ProcessRunning} {
		t.Run(code, func(t *testing.T) {
			err := (ProcessGuard{Inspector: process.Fake{Running: true}}).AssertStopped([]string{"game.exe"}, code)
			var coded *models.Error
			if !errors.As(err, &coded) || coded.Code != code {
				t.Fatalf("running process did not block operation with %s: %v", code, err)
			}
		})
	}
}

func TestTestProcessInitializationFailureDoesNotReportSafeToDeploy(t *testing.T) {
	expected := errors.New("Unable to inspect running processes")
	err := (ProcessGuard{Inspector: process.Fake{Err: expected}}).AssertStopped([]string{"game.exe"}, models.ProcessRunning)
	if err == nil || !errors.Is(err, expected) {
		t.Fatalf("inspection failure reported safe: %v", err)
	}
}
