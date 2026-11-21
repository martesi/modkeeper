package process

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestFake(t *testing.T) {
	inspector := Fake{Running: true}
	got, err := inspector.IsRunning(nil)
	if err != nil || !got {
		t.Fatalf("got %v, %v", got, err)
	}
}

// TestDetectCopiedRunningExecutable copies a long-running binary out of place
// and checks that the inspector still finds it through /proc. The copied
// program must not replace itself: a shell such as dash execs its final
// command, so `sh -c "sleep 30"` leaves the copied shell gone.
func TestDetectCopiedRunningExecutable(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux /proc inspector is only available on Linux")
	}
	source, err := exec.LookPath("sleep")
	if err != nil {
		t.Skipf("sleep executable unavailable: %v", err)
	}
	copyPath := filepath.Join(t.TempDir(), "copied-sleep")
	b, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(copyPath, b, 0755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(copyPath, "30")
	if err := cmd.Start(); err != nil {
		t.Skipf("environment forbids executing copied binaries: %v", err)
	}
	defer func() { _ = cmd.Process.Kill(); _ = cmd.Wait() }()
	inspector := Linux{}
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
		t.Fatalf("running copied executable not detected: %v, %v", running, err)
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
