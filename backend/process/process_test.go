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

func TestDetectCopiedRunningExecutable(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux /proc inspector is only available on Linux")
	}
	source, err := exec.LookPath("sh")
	if err != nil {
		t.Skipf("sh executable unavailable: %v", err)
	}
	copyPath := filepath.Join(t.TempDir(), "copied-shell")
	b, err := os.ReadFile(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(copyPath, b, 0755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(copyPath, "-c", "sleep 30")
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
