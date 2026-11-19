//go:build linux

package process

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Linux inspects /proc for executable paths.
type Linux struct{}

func (Linux) IsRunning(paths []string) (bool, error) {
	canonical := make(map[string]struct{}, len(paths))
	names := make(map[string]struct{}, len(paths))
	for _, path := range paths {
		resolved, err := filepath.EvalSymlinks(path)
		if err != nil {
			return false, fmt.Errorf("canonicalize executable %q: %w", path, err)
		}
		resolved, err = filepath.Abs(resolved)
		if err != nil {
			return false, err
		}
		canonical[filepath.Clean(resolved)] = struct{}{}
		name := filepath.Base(resolved)
		if name != "" {
			names[name] = struct{}{}
		}
	}
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return false, err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid := entry.Name()
		if _, err := fmt.Sscanf(pid, "%d", new(int)); err != nil {
			continue
		}
		exe := filepath.Join("/proc", pid, "exe")
		target, err := os.Readlink(exe)
		if err == nil {
			if _, ok := canonical[filepath.Clean(target)]; ok {
				return true, nil
			}
			continue
		}
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if !errors.Is(err, os.ErrPermission) {
			return false, fmt.Errorf("read %s: %w", exe, err)
		}
		comm, commErr := os.ReadFile(filepath.Join("/proc", pid, "comm"))
		if commErr != nil {
			if errors.Is(commErr, os.ErrNotExist) {
				continue
			}
			if errors.Is(commErr, os.ErrPermission) {
				continue
			}
			return false, fmt.Errorf("read process name for %s: %w", pid, commErr)
		}
		if _, ok := names[strings.TrimSpace(string(comm))]; ok {
			return true, nil
		}
	}
	return false, nil
}
