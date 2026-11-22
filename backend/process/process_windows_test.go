//go:build windows

package process

import (
	"os"
	"path/filepath"
	"testing"
)

// The inspector must find the test binary itself through the toolhelp snapshot.
func TestWindowsDetectsItsOwnImage(t *testing.T) {
	exe, err := os.Executable()
	if err != nil {
		t.Skipf("test binary path unavailable: %v", err)
	}
	running, err := (Windows{}).IsRunning([]string{exe})
	if err != nil || !running {
		t.Fatalf("running test binary not detected: %v, %v", running, err)
	}
}

func TestWindowsMissingExecutableIsNotAnInspectionFailure(t *testing.T) {
	running, err := (Windows{}).IsRunning([]string{filepath.Join(t.TempDir(), "absent.exe")})
	if err != nil || running {
		t.Fatalf("got %v, %v; want a safe absence", running, err)
	}
}
