//go:build !server

package main

import (
	"log"
	"os"
	"runtime"

	"github.com/martes/modkeeper/backend"
	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/logging"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func main() {
	appBackend := backend.NewApp()
	options := appOptions(appBackend)
	logger, closeLog := logging.New(appBackend.ConfigPath, os.Stderr)
	defer closeLog()
	if logger != nil {
		options.Logger = logger
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
		URL:    "/",
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
	// Wails applies backdrops when it creates the window. The macOS backdrop
	// needs the private_mac_apis build tag for webview transparency, and no
	// build path passes it, so the Mac window keeps a solid background until
	// hardware verification.
	if runtime.GOOS == "windows" {
		windowOptions.BackgroundType = application.BackgroundTypeTranslucent
		windowOptions.Windows.BackdropType = application.Mica
	}
	window := app.Window.NewWithOptions(windowOptions)
	forwardWindowFileDrops(window)
	startBackend(app, appBackend)
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
