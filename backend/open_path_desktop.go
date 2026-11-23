//go:build !server

package backend

import (
	"github.com/martes/modkeeper/backend/models"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// openPathTarget is a package variable so the desktop dispatch policy (folder
// versus file) can be tested without launching a real desktop handler.
var openPathTarget = func(path string, isDir bool) error {
	app := application.Get()
	if app == nil {
		return models.Fail(models.Unexpected, "file manager is unavailable before the Wails app starts")
	}
	if isDir {
		if app.Env == nil {
			return models.Fail(models.Unexpected, "file manager is unavailable before the Wails app starts")
		}
		if err := app.Env.OpenFileManager(path, false); err != nil {
			return models.Fail(models.IOError, err.Error())
		}
		return nil
	}
	if app.Browser == nil {
		return models.Fail(models.Unexpected, "file opener is unavailable before the Wails app starts")
	}
	if err := app.Browser.OpenFile(path); err != nil {
		return models.Fail(models.IOError, err.Error())
	}
	return nil
}
