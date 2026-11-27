package linker

import (
	"fmt"
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

type stageRenameInfo struct {
	replaceIfExists uint32
	rootDirectory   windows.Handle
	fileNameLength  uint32
	fileName        uint16
}

func createStageFile(path string) (*os.File, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, err
	}
	access := uint32(windows.GENERIC_READ | windows.GENERIC_WRITE | windows.DELETE | windows.FILE_READ_ATTRIBUTES)
	share := uint32(windows.FILE_SHARE_READ | windows.FILE_SHARE_WRITE | windows.FILE_SHARE_DELETE)
	handle, err := windows.CreateFile(name, access, share, nil, windows.CREATE_NEW, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(handle), path), nil
}

func publishStagedNoReplace(original *os.File, source, target string) error {
	current, err := os.Lstat(source)
	if err != nil {
		return fmt.Errorf("inspect named stage before handle rename: %w", err)
	}
	openedInfo, err := original.Stat()
	if err != nil {
		return err
	}
	if !os.SameFile(openedInfo, current) {
		return fmt.Errorf("named stage was substituted before handle rename")
	}
	info := openedInfo
	if !info.Mode().IsRegular() {
		return fmt.Errorf("staging handle is not a regular file")
	}
	var tag struct{ attributes, reparseTag uint32 }
	if err := windows.GetFileInformationByHandleEx(windows.Handle(original.Fd()), windows.FileAttributeTagInfo, (*byte)(unsafe.Pointer(&tag)), uint32(unsafe.Sizeof(tag))); err != nil {
		return fmt.Errorf("inspect staged handle attributes: %w", err)
	}
	if tag.attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 || tag.attributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0 {
		return fmt.Errorf("staged handle is a reparse point or directory")
	}
	if filepath.Clean(filepath.Dir(source)) != filepath.Clean(filepath.Dir(target)) {
		return fmt.Errorf("staged publication must stay in one directory")
	}

	parentName, err := windows.UTF16PtrFromString(filepath.Dir(target))
	if err != nil {
		return err
	}
	parent, err := windows.CreateFile(parentName, windows.GENERIC_READ|windows.GENERIC_WRITE|windows.FILE_LIST_DIRECTORY|windows.FILE_READ_ATTRIBUTES, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return fmt.Errorf("open staged target directory: %w", err)
	}
	defer windows.CloseHandle(parent)
	var parentTag struct{ attributes, reparseTag uint32 }
	if err := windows.GetFileInformationByHandleEx(parent, windows.FileAttributeTagInfo, (*byte)(unsafe.Pointer(&parentTag)), uint32(unsafe.Sizeof(parentTag))); err != nil {
		return fmt.Errorf("inspect staged target directory handle: %w", err)
	}
	if parentTag.attributes&windows.FILE_ATTRIBUTE_DIRECTORY == 0 || parentTag.attributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
		return fmt.Errorf("staged target parent is not an ordinary directory")
	}

	base, err := windows.UTF16FromString(filepath.Base(target))
	if err != nil {
		return err
	}
	base = base[:len(base)-1]
	buffer := make([]byte, int(unsafe.Sizeof(stageRenameInfo{}))+len(base)*2)
	rename := (*stageRenameInfo)(unsafe.Pointer(&buffer[0]))
	rename.rootDirectory = parent
	rename.fileNameLength = uint32(len(base) * 2)
	copy(unsafe.Slice(&rename.fileName, len(base)), base)
	var status windows.IO_STATUS_BLOCK
	if err := windows.NtSetInformationFile(windows.Handle(original.Fd()), &status, &buffer[0], uint32(len(buffer)), windows.FileRenameInformation); err != nil {
		return fmt.Errorf("rename staged object by original handle without replacement: %w", err)
	}
	return nil
}

// Direct no-replace publication is unsupported for legacy callers on Windows.
func publishNoReplace(source, target string) error {
	return fmt.Errorf("path-based no-replace publication is disabled on Windows")
}
