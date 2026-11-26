package process

import (
	"os"
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

func TestConfiguredExecutableBasenamesMatchExactlyCaseInsensitively(t *testing.T) {
	targets := configuredBasenames([]string{
		`C:\Games\EscapeFromTarkov.exe`,
		`C:\Games\SPT\SPT.Server.exe`,
	})
	for _, tc := range []struct {
		processName string
		want        bool
	}{
		{processName: "escapefromtarkov.EXE", want: true},
		{processName: "spt.server.exe", want: true},
		{processName: "EscapeFromTarkov.exe.old"},
		{processName: "SPT.Server.exe.bak"},
		{processName: "Secure System"},
		{processName: "unrelated.exe"},
	} {
		t.Run(tc.processName, func(t *testing.T) {
			if got := matchesConfiguredBasename(tc.processName, targets); got != tc.want {
				t.Fatalf("matchesConfiguredBasename(%q) = %v; want %v", tc.processName, got, tc.want)
			}
		})
	}
}

// TestProcessHelperBlock is the child of TestDetectCopiedRunningExecutable. A
// test binary is the most reliable copy target: the same environment that ran
// the suite can run it again.
func TestProcessHelperBlock(t *testing.T) {
	if os.Getenv("MODKEEPER_PROCESS_TEST_HELPER") != "1" {
		t.Skip("helper for TestDetectCopiedRunningExecutable")
	}
	time.Sleep(30 * time.Second)
}
