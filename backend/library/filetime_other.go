//go:build !linux && !windows

package library

import "time"

// createdTime reports no creation timestamp; callers fall back to mtime, which
// is also Rust's fallback when metadata.created() is unsupported.
func createdTime(string) (time.Time, bool) { return time.Time{}, false }
