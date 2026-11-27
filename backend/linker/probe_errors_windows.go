package linker

import (
	"errors"
	"os"

	"golang.org/x/sys/windows"
)

func capabilityUnavailable(err error) bool {
	return errors.Is(err, os.ErrPermission) || errors.Is(err, windows.ERROR_PRIVILEGE_NOT_HELD) || errors.Is(err, windows.ERROR_NOT_SAME_DEVICE) || errors.Is(err, windows.ERROR_NOT_SUPPORTED) || errors.Is(err, windows.ERROR_INVALID_FUNCTION) || errors.Is(err, windows.ERROR_INVALID_PARAMETER) || errors.Is(err, windows.ERROR_CALL_NOT_IMPLEMENTED)
}
