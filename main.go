//go:build !server

package main

import (
	"log"
	"os"
	"runtime"

	"github.com/martes/modkeeper/backend"
	"github.com/martes/modkeeper/backend/config"
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
	theme := config.ThemeSystem
	if appBackend.Library != nil {
		theme = appBackend.Library.GetSettings().Theme
	}
	appearance := backend.WindowAppearanceFor(theme)
	windowOptions := application.WebviewWindowOptions{
		Title:  "Modkeeper",
		Width:  1200,
		Height: 800,
		URL:    nativeSmokeURL(smoke),
		// The page body is the Wails file-drop target.
		EnableFileDrop: true,
		Mac: application.MacWindow{
			TitleBar:   application.MacTitleBarHiddenInsetUnified,
			Appearance: appearance.MacAppearance,
		},
		Windows: application.WindowsWindow{
			Theme: appearance.Theme,
		},
	}
	// Wails applies backdrops when it creates the window. Keep the window
	// opaque on Linux, where the backdrop options have no equivalent.
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		windowOptions.BackgroundType = application.BackgroundTypeTranslucent
	}
	if runtime.GOOS == "windows" {
		windowOptions.Windows.BackdropType = application.Mica
	}
	if runtime.GOOS == "darwin" {
		windowOptions.Mac.Backdrop = application.MacBackdropTranslucent
	}
	window := app.Window.NewWithOptions(windowOptions)
	forwardWindowFileDrops(app, window)
	startBackend(app, appBackend)
	if smoke {
		go runNativeSmoke(app, window, smokeService)
	}
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
