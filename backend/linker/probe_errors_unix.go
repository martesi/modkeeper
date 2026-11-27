//go:build !windows

package linker

import (
	"errors"
	"os"
	"syscall"
)

func capabilityUnavailable(err error) bool {
	return errors.Is(err, os.ErrPermission) || errors.Is(err, syscall.EXDEV) || errors.Is(err, syscall.EINVAL) || errors.Is(err, syscall.ENOTSUP) || errors.Is(err, syscall.ENOSYS)
}
