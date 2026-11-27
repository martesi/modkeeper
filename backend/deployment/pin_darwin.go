//go:build darwin

package deployment

import (
	"os"

	"golang.org/x/sys/unix"
)

type darwinPinnedObject struct {
	file *os.File
	info os.FileInfo
}

func pinObject(path string) (pinnedObject, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	flags := unix.O_RDONLY | unix.O_CLOEXEC | unix.O_NOFOLLOW
	if info.Mode()&os.ModeSymlink != 0 {
		flags |= unix.O_SYMLINK
	}
	fd, err := unix.Open(path, flags, 0)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), path)
	pinnedInfo, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	return &darwinPinnedObject{file: file, info: pinnedInfo}, nil
}

func pinPublishedFile(path string) (pinnedObject, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	return &darwinPinnedObject{file: file, info: info}, nil
}

func pinOpenFile(original *os.File) (pinnedObject, error) {
	fd, err := unix.Dup(int(original.Fd()))
	if err != nil {
		return nil, err
	}
	unix.CloseOnExec(fd)
	file := os.NewFile(uintptr(fd), original.Name())
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	return &darwinPinnedObject{file: file, info: info}, nil
}

func (p *darwinPinnedObject) matches(path string) (bool, error) {
	current, err := os.Lstat(path)
	if err != nil {
		return false, err
	}
	return os.SameFile(p.info, current), nil
}

func (p *darwinPinnedObject) matchesInfo(info os.FileInfo) bool { return os.SameFile(p.info, info) }

func (p *darwinPinnedObject) close() error { return p.file.Close() }

func (p *darwinPinnedObject) fingerprint() (string, error) { return fingerprintFile(p.file) }
