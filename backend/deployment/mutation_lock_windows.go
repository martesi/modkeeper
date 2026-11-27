package deployment

import (
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
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
	path = strings.ToLower(path)
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	h, err := windows.CreateFile(name, windows.GENERIC_READ|windows.GENERIC_WRITE, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_ALWAYS, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	var info windows.ByHandleFileInformation
	if err = windows.GetFileInformationByHandle(h, &info); err != nil || info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || info.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0 {
		_ = windows.CloseHandle(h)
		if err == nil {
			err = windows.ERROR_INVALID_DATA
		}
		return nil, err
	}
	var overlapped windows.Overlapped
	if err = windows.LockFileEx(h, windows.LOCKFILE_EXCLUSIVE_LOCK, 0, 1, 0, &overlapped); err != nil {
		_ = windows.CloseHandle(h)
		return nil, err
	}
	return func() {
		_ = windows.UnlockFileEx(h, 0, 1, 0, &overlapped)
		_ = windows.CloseHandle(h)
	}, nil
}
