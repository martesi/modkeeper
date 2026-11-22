//go:build linux

package library

import (
	"time"

	"golang.org/x/sys/unix"
)

// createdTime reads the filesystem birth time. Rust's metadata.created() uses
// statx on Linux; ENOSYS and filesystems without btime fall back to mtime.
func createdTime(path string) (time.Time, bool) {
	var stat unix.Statx_t
	if err := unix.Statx(unix.AT_FDCWD, path, 0, unix.STATX_BTIME, &stat); err != nil {
		return time.Time{}, false
	}
	if stat.Mask&unix.STATX_BTIME == 0 {
		return time.Time{}, false
	}
	return time.Unix(stat.Btime.Sec, int64(stat.Btime.Nsec)), true
}
