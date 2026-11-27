package deployment

import (
	"fmt"

	"golang.org/x/sys/unix"
)

func fileIdentity(path string) (string, error) {
	var stat unix.Statx_t
	if err := unix.Statx(unix.AT_FDCWD, path, unix.AT_SYMLINK_NOFOLLOW, unix.STATX_INO|unix.STATX_BTIME, &stat); err != nil {
		return "", err
	}
	// Inodes alone can be reused immediately after an unlink.
	if stat.Mask&(unix.STATX_INO|unix.STATX_BTIME) != unix.STATX_INO|unix.STATX_BTIME {
		return "", fmt.Errorf("filesystem cannot prove object identity across restarts: %s", path)
	}
	return fmt.Sprintf("%x:%x:%x:%x:%x", stat.Dev_major, stat.Dev_minor, stat.Ino, stat.Btime.Sec, stat.Btime.Nsec), nil
}
