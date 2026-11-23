package backend

import (
	"github.com/martes/modkeeper/backend/models"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// Log writes a frontend diagnostic through the Wails application logger. The
// desktop entrypoint points that logger at a file in the config directory, so
// this replaces Tauri's log plugin.
func (a *App) Log(message string) error {
	app := application.Get()
	if app == nil || app.Logger == nil {
		return models.Fail(models.Unexpected, "application logger is unavailable")
	}
	app.Logger.With("source", "frontend").Info(message)
	return nil
}
