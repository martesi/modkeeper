//go:build darwin

package linker

import (
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

func createStageFile(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
}

func publishNoReplace(source, target string) error {
	if err := unix.RenameatxNp(unix.AT_FDCWD, source, unix.AT_FDCWD, target, unix.RENAME_EXCL); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(target))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func publishStagedNoReplace(original *os.File, source, target string) error {
	originalInfo, err := original.Stat()
	if err != nil {
		return err
	}
	current, err := os.Lstat(source)
	if err != nil {
		return fmt.Errorf("inspect named stage before publication: %w", err)
	}
	if !os.SameFile(originalInfo, current) {
		return fmt.Errorf("named stage was substituted before publication")
	}
	return publishNoReplace(source, target)
}
