// Package process inspects whether executable paths are currently running.
package process

import "errors"

// ErrUnsupported marks platforms without a process inspection implementation.
var ErrUnsupported = errors.New("process inspection is unsupported on this platform")

// Inspector checks whether any of the supplied executable paths are running.
// Implementations must return errors rather than reporting a safe absence when
// inspection cannot be completed.
type Inspector interface {
	IsRunning(paths []string) (bool, error)
}

// Default returns the inspector for the running platform. Callers must still
// propagate its errors; Unsupported reports that inspection is unavailable.
func Default() Inspector { return defaultInspector() }

// Fake is a deterministic inspector for tests.
type Fake struct {
	Running bool
	Err     error
}

func (f Fake) IsRunning([]string) (bool, error) { return f.Running, f.Err }
