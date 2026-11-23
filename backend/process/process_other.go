//go:build !linux && !windows

package process

// Unsupported is the explicit no-op on operating systems without an
// implementation. The current implementation shell reports "not running" off Windows because
// native process-image inspection is unavailable there, and mirroring that
// keeps sync and delete usable instead of failing forever.
type Unsupported struct{}

func defaultInspector() Inspector { return Unsupported{} }

func (Unsupported) IsRunning([]string) (bool, error) { return false, nil }
