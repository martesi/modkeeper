//go:build server

package backend

import "github.com/martes/modkeeper/backend/models"

func openPathInFileManager(string) error {
	return models.Fail(models.Unexpected, "openPath is unavailable in server mode")
}
