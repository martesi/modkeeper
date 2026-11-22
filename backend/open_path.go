package backend

import (
	"os"
	"strings"

	"github.com/martes/modkeeper/backend/models"
)

// OpenPath reveals a directory in the OS file manager and opens a file with
// the OS default handler. Wails v3 has no JavaScript opener, so the frontend
// calls this bound method for "open folder" actions and tool launches.
//
// The operation is unavailable in the headless server build: there is no user
// desktop on the server host to open.
func (a *App) OpenPath(path string) error {
	if strings.TrimSpace(path) == "" {
		return models.Fail(models.FileOrDirectoryNotFound, path)
	}
	info, err := os.Stat(path)
	if err != nil {
		return models.Fail(models.FileOrDirectoryNotFound, path)
	}
	return openPathTarget(path, info.IsDir())
}
