package deployment

import "golang.org/x/sys/windows"

func archiveLegacyRecord(source, target string) error {
	src, err := windows.UTF16PtrFromString(source)
	if err != nil {
		return err
	}
	dst, err := windows.UTF16PtrFromString(target)
	if err != nil {
		return err
	}
	return windows.MoveFile(src, dst)
}
