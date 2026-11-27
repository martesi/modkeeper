//go:build !windows

package deployment

import "os"

func createSyncJournalFile(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR|os.O_APPEND, 0600)
}
