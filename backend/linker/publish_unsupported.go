//go:build !linux && !windows && !darwin

package linker

import (
	"errors"
	"os"
)

func publishNoReplace(source, target string) error {
	return errors.New("durable no-replace publication is unsupported on this platform")
}

func publishStagedNoReplace(*os.File, string, string) error {
	return errors.New("durable staged publication is unsupported on this platform")
}

func createStageFile(string) (*os.File, error) {
	return nil, errors.New("durable staged publication is unsupported on this platform")
}
