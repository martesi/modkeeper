//go:build !windows

package deployment

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

func acquireMutationLock(l Layout) (func(), error) {
	libraryRoot, err := filepath.EvalSymlinks(l.LibraryRoot)
	if err != nil {
		return nil, err
	}
	libraryParent := filepath.Dir(libraryRoot)
	if filepath.Base(libraryRoot) == ".mod_keeper" {
		libraryParent = filepath.Dir(libraryParent)
	}
	libraryPath := filepath.Join(libraryParent, "."+filepath.Base(libraryRoot)+".sync-operation.lock")
	releaseLibrary, err := acquireFileLock(libraryPath)
	if err != nil {
		return nil, err
	}
	gameRoot, err := filepath.EvalSymlinks(l.GameRoot)
	if err != nil {
		releaseLibrary()
		return nil, err
	}
	gamePath := filepath.Join(filepath.Dir(gameRoot), "."+filepath.Base(gameRoot)+".modkeeper-sync-operation.lock")
	releaseGame, err := acquireFileLock(gamePath)
	if err != nil {
		releaseLibrary()
		return nil, err
	}
	return func() {
		releaseGame()
		releaseLibrary()
	}, nil
}

func acquireFileLock(path string) (func(), error) {
	fd, err := unix.Open(path, unix.O_CREAT|unix.O_RDWR|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), path)
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		_ = f.Close()
		if err == nil {
			err = os.ErrInvalid
		}
		return nil, err
	}
	if err = unix.Flock(int(f.Fd()), unix.LOCK_EX); err != nil {
		_ = f.Close()
		return nil, err
	}
	return func() {
		_ = unix.Flock(int(f.Fd()), unix.LOCK_UN)
		_ = f.Close()
	}, nil
}
