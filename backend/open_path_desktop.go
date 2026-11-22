//go:build !server

package backend

import (
	"github.com/martes/modkeeper/backend/models"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func openPathInFileManager(path string) error {
	app := application.Get()
	if app == nil || app.Env == nil {
		return models.Fail(models.Unexpected, "file manager is unavailable before the Wails app starts")
	}
	if err := app.Env.OpenFileManager(path, false); err != nil {
		return models.Fail(models.IOError, err.Error())
	}
	return nil
}
