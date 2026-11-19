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
	services := []application.Service{
		application.NewService(backend.NewApp()),
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
	if smoke {
		go runNativeSmoke(app, window, smokeService)
	}
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
