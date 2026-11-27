//go:build !linux && !darwin && !windows

package deployment

import "errors"

func archiveLegacyRecord(_, _ string) error {
	return errors.ErrUnsupported
}
