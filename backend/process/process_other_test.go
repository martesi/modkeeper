//go:build !linux && !windows

package process

import "testing"

// Unsupported platforms mirror the Rust shell: native process-image inspection
// is unavailable, so the guard reports a documented absence instead of failing
// every destructive command.
func TestUnsupportedReportsNotRunning(t *testing.T) {
	running, err := (Unsupported{}).IsRunning([]string{"game.exe"})
	if err != nil || running {
		t.Fatalf("got %v, %v; want a documented absence", running, err)
	}
}
