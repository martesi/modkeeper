//go:build !linux && !windows && !darwin

package deployment

import (
	"errors"
	"os"
)

type unsupportedPinnedObject struct{}

func pinObject(string) (pinnedObject, error) {
	return nil, errors.New("live object pinning is unsupported on this platform")
}

func pinPublishedFile(string) (pinnedObject, error) {
	return nil, errors.New("live object pinning is unsupported on this platform")
}

func pinOpenFile(*os.File) (pinnedObject, error) {
	return nil, errors.New("live object pinning is unsupported on this platform")
}

func (*unsupportedPinnedObject) matches(string) (bool, error) { return false, nil }
func (*unsupportedPinnedObject) matchesInfo(os.FileInfo) bool { return false }
func (*unsupportedPinnedObject) fingerprint() (string, error) {
	return "", errors.New("live object fingerprinting is unsupported on this platform")
}
func (*unsupportedPinnedObject) close() error { return nil }
