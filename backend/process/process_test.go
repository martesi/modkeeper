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

// TestProcessHelperBlock is the child of TestDetectCopiedRunningExecutable. A
// test binary is the most reliable copy target: the same environment that ran
// the suite can run it again.
func TestProcessHelperBlock(t *testing.T) {
	if os.Getenv("MODKEEPER_PROCESS_TEST_HELPER") != "1" {
		t.Skip("helper for TestDetectCopiedRunningExecutable")
	}
	time.Sleep(30 * time.Second)
}
