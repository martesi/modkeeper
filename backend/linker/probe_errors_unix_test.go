//go:build !windows

package linker

import (
	"errors"
	"fmt"
	"os"
	"syscall"
	"testing"
)

const crossDeviceError = syscall.EXDEV

func TestCapabilityUnavailableNativeErrors(t *testing.T) {
	for _, cause := range []error{syscall.EXDEV, syscall.EINVAL, syscall.ENOTSUP, syscall.ENOSYS, syscall.EPERM} {
		if !capabilityUnavailable(fmt.Errorf("wrapped: %w", &os.LinkError{Op: "link", Err: cause})) {
			t.Errorf("not classified: %v", cause)
		}
	}
	if capabilityUnavailable(fmt.Errorf("wrapped: %w", syscall.EIO)) || capabilityUnavailable(errors.New("unexpected")) {
		t.Fatal("unexpected error classified as unavailable")
	}
}
