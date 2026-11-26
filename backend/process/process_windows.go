//go:build windows

package process

import (
	"errors"
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Windows compares configured executable basenames with the process snapshot.
// It does not open processes or resolve executable paths.
type Windows struct{}

func defaultInspector() Inspector { return Windows{} }

func (Windows) IsRunning(paths []string) (bool, error) {
	return inspectProcessSnapshot(createToolhelpSnapshot, paths)
}

type processSnapshot interface {
	First() (name string, done bool, err error)
	Next() (name string, done bool, err error)
	Close() error
}

type toolhelpSnapshot struct {
	handle windows.Handle
	entry  windows.ProcessEntry32
}

func createToolhelpSnapshot() (processSnapshot, error) {
	handle, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	return &toolhelpSnapshot{handle: handle}, nil
}

func (s *toolhelpSnapshot) First() (string, bool, error) {
	s.entry.Size = uint32(unsafe.Sizeof(s.entry))
	err := windows.Process32First(s.handle, &s.entry)
	return snapshotResult(s.entry, err)
}

func (s *toolhelpSnapshot) Next() (string, bool, error) {
	err := windows.Process32Next(s.handle, &s.entry)
	return snapshotResult(s.entry, err)
}

func (s *toolhelpSnapshot) Close() error {
	return windows.CloseHandle(s.handle)
}

func snapshotResult(entry windows.ProcessEntry32, err error) (string, bool, error) {
	if errors.Is(err, windows.ERROR_NO_MORE_FILES) {
		return "", true, nil
	}
	if err != nil {
		return "", false, err
	}
	return windows.UTF16ToString(entry.ExeFile[:]), false, nil
}

func inspectProcessSnapshot(
	create func() (processSnapshot, error),
	paths []string,
) (running bool, resultErr error) {
	targets := configuredBasenames(paths)
	if len(targets) == 0 {
		return false, nil
	}

	snapshot, err := create()
	if err != nil {
		return false, fmt.Errorf("snapshot processes: %w", err)
	}
	defer func() {
		if err := snapshot.Close(); err != nil {
			running = false
			resultErr = errors.Join(resultErr, fmt.Errorf("close process snapshot: %w", err))
		}
	}()

	name, done, err := snapshot.First()
	if err != nil {
		return false, fmt.Errorf("enumerate processes: %w", err)
	}
	for !done {
		if matchesConfiguredBasename(name, targets) {
			return true, nil
		}
		name, done, err = snapshot.Next()
		if err != nil {
			return false, fmt.Errorf("enumerate processes: %w", err)
		}
	}
	return false, nil
}
