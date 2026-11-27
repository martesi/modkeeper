package linker

import (
	"fmt"
	"os"
	"testing"

	"golang.org/x/sys/windows"
)

const crossDeviceError = windows.ERROR_NOT_SAME_DEVICE

func TestCapabilityUnavailableNativeErrors(t *testing.T) {
	for _, cause := range []error{windows.ERROR_PRIVILEGE_NOT_HELD, windows.ERROR_NOT_SAME_DEVICE, windows.ERROR_NOT_SUPPORTED, windows.ERROR_INVALID_FUNCTION, windows.ERROR_INVALID_PARAMETER, windows.ERROR_CALL_NOT_IMPLEMENTED, windows.ERROR_ACCESS_DENIED} {
		if !capabilityUnavailable(fmt.Errorf("wrapped: %w", &os.LinkError{Op: "link", Err: cause})) {
			t.Errorf("not classified: %v", cause)
		}
	}
	if capabilityUnavailable(fmt.Errorf("wrapped: %w", windows.ERROR_DISK_FULL)) {
		t.Fatal("disk full classified as unavailable")
	}
}
