package main

import (
	"embed"
	"log"
	"os"

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

func main() {
	smoke := os.Getenv("MODKEEPER_NATIVE_SMOKE") == "1"
	smokeService := newNativeSmokeService()
	appBackend := backend.NewApp()
	services := []application.Service{
		application.NewService(appBackend),
	}
	if smoke {
		application.RegisterEvent[string]("native-smoke-event")
		services = append(services, application.NewService(smokeService))
	}
	app := application.New(application.Options{
		Name:        "Modkeeper",
		Description: "Game mod management and development",
		Services:    services,
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(frontend),
		},
	})
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "Modkeeper",
		Width:  1200,
		Height: 800,
		URL:    nativeSmokeURL(smoke),
	})
	if appBackend.InitErr != nil {
		log.Printf("modkeeper: config/library initialization failed: %v", appBackend.InitErr)
	} else {
		appBackend.Sink = wailsEventSink{app: app}
		if err := appBackend.Start(); err != nil {
			log.Printf("modkeeper: startup load failed: %v", err)
		}
	}
	if smoke {
		go runNativeSmoke(app, window, smokeService)
	}
	if err := app.Run(); err != nil {
		log.Fatal(err)
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
