package registry

import (
	"errors"
	"testing"

	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/process"
)

func TestStartupLibraryWaitsForBackgroundLoadCompletion(t *testing.T) {
	t.Skip("blocked on wails/wc-library-crud: startup load coordination is not implemented")
}
func TestTestTaskIdInUseRejectedUntilFinished(t *testing.T) {
	t.Skip("blocked on wails/wc-library-crud: in-flight task ID guard is not implemented")
}
func TestTestAssertActiveLibraryRejectsNonActive(t *testing.T) {
	t.Skip("blocked on wails/wc-library-crud: active-library validation is not implemented")
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
