//go:build windows

package process

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Windows matches process image paths from a toolhelp snapshot, mirroring the
// Rust shell's exact-path check against sysinfo.
type Windows struct{}

func defaultInspector() Inspector { return Windows{} }

func (Windows) IsRunning(paths []string) (bool, error) {
	targets := make(map[string]struct{}, len(paths))
	for _, path := range paths {
		absolute, err := filepath.Abs(path)
		if err != nil {
			return false, fmt.Errorf("canonicalize executable %q: %w", path, err)
		}
		// Windows paths compare case-insensitively.
		targets[strings.ToLower(filepath.Clean(absolute))] = struct{}{}
	}
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return false, fmt.Errorf("snapshot processes: %w", err)
	}
	defer windows.CloseHandle(snapshot)
	entry := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	for err = windows.Process32First(snapshot, &entry); err == nil; err = windows.Process32Next(snapshot, &entry) {
		image, imageErr := processImage(entry.ProcessID)
		if imageErr != nil {
			// A process can exit between the snapshot and the query, and
			// protected processes stay unreadable. Skipping them matches the
			// Rust shell, whose sysinfo listing also omits inaccessible images.
			if errors.Is(imageErr, windows.ERROR_INVALID_PARAMETER) || errors.Is(imageErr, windows.ERROR_ACCESS_DENIED) {
				continue
			}
			return false, imageErr
		}
		if _, running := targets[strings.ToLower(filepath.Clean(image))]; running {
			return true, nil
		}
	}
	if errors.Is(err, windows.ERROR_NO_MORE_FILES) {
		return false, nil
	}
	return false, fmt.Errorf("enumerate processes: %w", err)
}

func processImage(pid uint32) (string, error) {
	handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return "", err
	}
	defer windows.CloseHandle(handle)
	buffer := make([]uint16, windows.MAX_LONG_PATH)
	size := uint32(len(buffer))
	if err := windows.QueryFullProcessImageName(handle, 0, &buffer[0], &size); err != nil {
		return "", err
	}
	return windows.UTF16ToString(buffer[:size]), nil
}
