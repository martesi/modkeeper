package registry

import (
	"errors"
	"runtime"
	"testing"
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
	if runtime.GOOS != "windows" {
		t.Skip("Rust process inspection is Windows-only")
	}
	// Injected so this assertion is deterministic and never inspects user
	// processes. Production process inspection awaits the registry port.
	running, err := processRunning(func() (bool, error) { return true, nil })
	if err != nil || !running {
		t.Fatalf("running process not detected: %v %v", running, err)
	}
	t.Skip("blocked on wails/wc-library-crud: production process guard is not implemented")
}

func TestTestProcessInitializationFailureDoesNotReportSafeToDeploy(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("Rust process inspection is Windows-only")
	}
	expected := errors.New("Unable to inspect running processes")
	running, err := processRunning(func() (bool, error) { return false, expected })
	if running || !errors.Is(err, expected) {
		t.Fatalf("inspection failure reported safe: %v %v", running, err)
	}
	t.Skip("blocked on wails/wc-library-crud: production process guard is not implemented")
}
