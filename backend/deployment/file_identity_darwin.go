//go:build darwin

package deployment

import (
	"fmt"
	"os"
	"syscall"
)

func fileIdentity(path string) (string, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return "", fmt.Errorf("filesystem did not provide a native object identity")
	}
	return fmt.Sprintf("%x:%x:%x:%x", uint64(stat.Dev), uint64(stat.Ino), stat.Birthtimespec.Sec, stat.Birthtimespec.Nsec), nil
}
