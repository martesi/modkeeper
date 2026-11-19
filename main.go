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

func main() {
	app := application.New(application.Options{
		Name:        "Modkeeper",
		Description: "Game mod management and development",
		Services: []application.Service{
			application.NewService(backend.NewApp()),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(frontend),
		},
	})
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "Modkeeper",
		Width:  1200,
		Height: 800,
		URL:    "/",
	})
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
