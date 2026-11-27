package deployment

import (
	"fmt"
	"os"
	"unsafe"

	"github.com/martes/modkeeper/backend/linker"
	"golang.org/x/sys/windows"
)

func inspectLink(path string) (os.FileInfo, linker.ArtifactKind, error) {
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return nil, "", fmt.Errorf("encode path: %w", err)
	}
	// Match os.openSymlink: zero desired access is enough to inspect the
	// reparse point and works for links whose targets cannot be opened.
	h, err := windows.CreateFile(name, 0, 0, nil, windows.OPEN_EXISTING, windows.FILE_FLAG_OPEN_REPARSE_POINT|windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		return nil, "", fmt.Errorf("open reparse point: %w", err)
	}
	f := os.NewFile(uintptr(h), path)
	defer f.Close()
	opened, err := f.Stat()
	if err != nil {
		return nil, "", fmt.Errorf("stat reparse-point handle: %w", err)
	}
	var tag struct{ attributes, reparseTag uint32 }
	if err := windows.GetFileInformationByHandleEx(h, windows.FileAttributeTagInfo, (*byte)(unsafe.Pointer(&tag)), uint32(unsafe.Sizeof(tag))); err != nil {
		return nil, "", fmt.Errorf("query reparse tag: %w", err)
	}
	switch tag.reparseTag {
	case windows.IO_REPARSE_TAG_SYMLINK:
		return opened, linker.Symlink, nil
	case windows.IO_REPARSE_TAG_MOUNT_POINT:
		return opened, linker.Junction, nil
	default:
		return opened, "", nil
	}
}
