//go:build e2e

package deployment

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

func e2eSyncBoundary() func(string) error {
	dir := os.Getenv("MODKEEPER_E2E_SYNC_HOOK_DIR")
	if dir == "" {
		return nil
	}
	return func(boundary string) error {
		request, err := os.ReadFile(filepath.Join(dir, "pause-at"))
		if err != nil || strings.TrimSpace(string(request)) != boundary {
			return nil
		}
		if err := os.WriteFile(filepath.Join(dir, "reached"), []byte(boundary), 0600); err != nil {
			return err
		}
		for {
			if _, err := os.Stat(filepath.Join(dir, "release")); err == nil {
				return nil
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
}
