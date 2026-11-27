//go:build linux

package deployment

import (
	"os"

	"golang.org/x/sys/unix"
)

type linuxPinnedObject struct {
	file *os.File
	info os.FileInfo
}

func pinObject(path string) (pinnedObject, error) {
	fd, err := unix.Open(path, unix.O_PATH|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), path)
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	return &linuxPinnedObject{file: file, info: info}, nil
}

func pinPublishedFile(path string) (pinnedObject, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), path)
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	return &linuxPinnedObject{file: file, info: info}, nil
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
	return &linuxPinnedObject{file: file, info: info}, nil
}

func (p *linuxPinnedObject) matches(path string) (bool, error) {
	current, err := os.Lstat(path)
	if err != nil {
		return false, err
	}
	return os.SameFile(p.info, current), nil
}

func (p *linuxPinnedObject) matchesInfo(info os.FileInfo) bool { return os.SameFile(p.info, info) }

func (p *linuxPinnedObject) close() error { return p.file.Close() }

func (p *linuxPinnedObject) fingerprint() (string, error) { return fingerprintFile(p.file) }
