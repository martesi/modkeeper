package main

import (
	"embed"
	"log"

	"github.com/martes/modkeeper/backend"
	"github.com/martes/modkeeper/backend/models"
	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:dist
var frontend embed.FS

func init() {
	application.RegisterEvent[models.TaskProgressEvent]("task_progress")
	application.RegisterEvent[any]("workspace-event")
}

// appOptions builds the application.Options shared by the desktop entrypoint
// (main.go) and the headless server entrypoint (main_server.go), so services,
// embedded assets and event wiring cannot drift between the two. Callers add
// mode-specific services and options, then pass the result to application.New.
func appOptions(appBackend *backend.App) application.Options {
	return application.Options{
		Name:        "Modkeeper",
		Description: "Game mod management and development",
		Services: []application.Service{
			application.NewService(appBackend),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(frontend),
		},
	}
}

// startBackend wires the event sink and loads saved state. Both entrypoints
// need this, and a broken config must not stop the UI from opening, so
// failures are logged rather than returned.
func startBackend(app *application.App, appBackend *backend.App) {
	if appBackend.InitErr != nil {
		log.Printf("modkeeper: config/library initialization failed: %v", appBackend.InitErr)
		return
	}
	appBackend.Sink = wailsEventSink{app: app}
	if err := appBackend.Start(); err != nil {
		log.Printf("modkeeper: startup load failed: %v", err)
	}
}

// wailsEventSink forwards service events to the Wails event bus.
type wailsEventSink struct{ app *application.App }

func (s wailsEventSink) Progress(event models.TaskProgressEvent) error {
	s.app.Event.Emit("task_progress", event)
	return nil
}

func (s wailsEventSink) Workspace(event models.WorkspaceEvent) error {
	s.app.Event.Emit("workspace-event", event)
	return nil
}
