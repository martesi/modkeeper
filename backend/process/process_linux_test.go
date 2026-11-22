//go:build linux

package process

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A target executable that no longer exists cannot be running. Treating it as
// an inspection failure would make a broken library impossible to delete.
func TestMissingExecutableIsNotAnInspectionFailure(t *testing.T) {
	running, err := (Linux{}).IsRunning([]string{filepath.Join(t.TempDir(), "absent.exe")})
	if err != nil || running {
		t.Fatalf("got %v, %v; want a safe absence", running, err)
	}
}

// TestDetectCopiedRunningExecutable copies a long-running executable out of
// place and checks that the inspector still finds it through /proc. A shell is
// a poor copy target because implementations such as dash exec their final
// command, leaving the copied shell gone.
func TestDetectCopiedRunningExecutable(t *testing.T) {
	source, err := os.Executable()
	if err != nil {
		t.Skipf("test binary path unavailable: %v", err)
	}
	copyPath := filepath.Join(t.TempDir(), "copied-test-binary")
	b, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(copyPath, b, 0755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(copyPath, "-test.run=^TestProcessHelperBlock$")
	cmd.Env = append(os.Environ(), "MODKEEPER_PROCESS_TEST_HELPER=1")
	if err := cmd.Start(); err != nil {
		t.Skipf("environment forbids executing copied binaries: %v", err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	inspector := Linux{}
	// Some restricted environments reap the grandchild immediately; the
	// inspector cannot be exercised there, and reporting that as a detection
	// failure would blame the code for the sandbox.
	alive := false
	for deadline := time.Now().Add(time.Second); time.Now().Before(deadline); {
		if _, err := os.Stat(fmt.Sprintf("/proc/%d/exe", cmd.Process.Pid)); err == nil {
			alive = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !alive {
		comm, _ := os.ReadFile(fmt.Sprintf("/proc/%d/comm", cmd.Process.Pid))
		t.Skipf("environment did not keep the copied executable alive (comm %q)", strings.TrimSpace(string(comm)))
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		running, err := inspector.IsRunning([]string{copyPath})
		if err != nil {
			t.Fatal(err)
		}
		if running {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	running, err := inspector.IsRunning([]string{copyPath})
	if err != nil || !running {
		exe, exeErr := os.Readlink(fmt.Sprintf("/proc/%d/exe", cmd.Process.Pid))
		comm, commErr := os.ReadFile(fmt.Sprintf("/proc/%d/comm", cmd.Process.Pid))
		t.Fatalf("running copied executable not detected: %v, %v (child exe %q %v, comm %q %v, copy %q)", running, err, exe, exeErr, strings.TrimSpace(string(comm)), commErr, copyPath)
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Wait(); err != nil { /* expected after kill */
	}
	running, err = inspector.IsRunning([]string{copyPath})
	if err != nil || running {
		t.Fatalf("stopped executable still detected: %v, %v", running, err)
	}
}
