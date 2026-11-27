package deployment

import (
	"os"

	"golang.org/x/sys/windows"
)

type windowsPinnedObject struct {
	file *os.File
	info os.FileInfo
}

func pinObject(path string) (pinnedObject, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	h, err := windows.CreateFile(name, windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(h), path)
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	return &windowsPinnedObject{file: file, info: info}, nil
}

func pinPublishedFile(path string) (pinnedObject, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	h, err := windows.CreateFile(name, windows.GENERIC_READ|windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(h), path)
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	return &windowsPinnedObject{file: file, info: info}, nil
}

func pinOpenFile(original *os.File) (pinnedObject, error) {
	var handle windows.Handle
	process := windows.CurrentProcess()
	if err := windows.DuplicateHandle(process, windows.Handle(original.Fd()), process, &handle, 0, false, windows.DUPLICATE_SAME_ACCESS); err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(handle), original.Name())
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	return &windowsPinnedObject{file: file, info: info}, nil
}

func (p *windowsPinnedObject) matches(path string) (bool, error) {
	current, err := os.Lstat(path)
	if err != nil {
		return false, err
	}
	return os.SameFile(p.info, current), nil
}

func (p *windowsPinnedObject) matchesInfo(info os.FileInfo) bool { return os.SameFile(p.info, info) }

func (p *windowsPinnedObject) close() error { return p.file.Close() }

func (p *windowsPinnedObject) fingerprint() (string, error) { return fingerprintFile(p.file) }
