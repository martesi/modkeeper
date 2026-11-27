//go:build !windows

package deployment

import "os"

func syncDirectoryDurably(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
