//go:build !linux && !windows

package process

// Unsupported is the explicit fallback on operating systems without an
// implementation. Callers must treat ErrUnsupported as an inspection failure,
// not as proof that deployment is safe.
type Unsupported struct{}

func defaultInspector() Inspector { return Unsupported{} }

func (Unsupported) IsRunning([]string) (bool, error) { return false, ErrUnsupported }
