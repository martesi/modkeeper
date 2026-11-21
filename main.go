//go:build !server

package main

import (
	"log"
	"os"

	"github.com/martes/modkeeper/backend"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func main() {
	smoke := os.Getenv("MODKEEPER_NATIVE_SMOKE") == "1"
	smokeService := newNativeSmokeService()
	appBackend := backend.NewApp()
	if smoke && os.Getenv("MODKEEPER_NATIVE_SMOKE_CONFIG") != "" {
		appBackend = backend.NewAppAt(os.Getenv("MODKEEPER_NATIVE_SMOKE_CONFIG"))
	}
	if smoke && appBackend.Library != nil {
		appBackend.Library.SetInstallTaskHook(func(taskID string) {
			if taskID == "native-busy" {
				smokeService.HoldInstall()
			}
		})
	}
	options := appOptions(appBackend)
	if smoke {
		application.RegisterEvent[string]("native-smoke-event")
		options.Services = append(options.Services, application.NewService(smokeService))
	}
	app := application.New(options)
	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "Modkeeper",
		Width:  1200,
		Height: 800,
		URL:    nativeSmokeURL(smoke),
	})
	startBackend(app, appBackend)
	if smoke {
		go runNativeSmoke(app, window, smokeService)
	}
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
