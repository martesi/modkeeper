//go:build windows

package library

import (
	"os"
	"syscall"
	"time"
)

// createdTime reads the creation timestamp, matching Rust's metadata.created().
func createdTime(path string) (time.Time, bool) {
	info, err := os.Stat(path)
	if err != nil {
		return time.Time{}, false
	}
	data, ok := info.Sys().(*syscall.Win32FileAttributeData)
	if !ok {
		return time.Time{}, false
	}
	return time.Unix(0, data.CreationTime.Nanoseconds()), true
}
