// Package process inspects whether executable paths are currently running.
package process

import "strings"

// Inspector checks whether any of the supplied executable paths are running.
// Implementations must return errors rather than reporting a safe absence when
// inspection cannot be completed. Platforms without native inspection report a
// documented absence instead, matching the current implementation shell's non-Windows behavior.
type Inspector interface {
	IsRunning(paths []string) (bool, error)
}

// Default returns the inspector for the running platform. Callers must still
// propagate its errors; Unsupported is the documented no-op fallback.
func Default() Inspector { return defaultInspector() }

// Fake is a deterministic inspector for tests.
type Fake struct {
	Running bool
	Err     error
}

func (f Fake) IsRunning([]string) (bool, error) { return f.Running, f.Err }

func configuredBasenames(paths []string) []string {
	names := make([]string, 0, len(paths))
	for _, path := range paths {
		name := path[strings.LastIndexAny(path, `/\\`)+1:]
		if name != "" && name != "." && name != ".." {
			names = append(names, name)
		}
	}
	return names
}

func matchesConfiguredBasename(processName string, targets []string) bool {
	for _, target := range targets {
		if strings.EqualFold(processName, target) {
			return true
		}
	}
	return false
}
