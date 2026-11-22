//go:build !server

package main

import (
	"io"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"

	"github.com/martes/modkeeper/backend"
	"github.com/martes/modkeeper/backend/config"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// configureLogging gives the Wails application logger a file sink in the config
// directory. The frontend Log bound method writes through this logger, which is
// the Wails counterpart to Tauri's log plugin.
func configureLogging(options *application.Options, configPath string) func() {
	path := logFilePath(configPath)
	if path == "" {
		log.Printf("modkeeper: no log file path available; logging to stderr only")
		return func() {}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		log.Printf("modkeeper: cannot create log directory for %s: %v", path, err)
		return func() {}
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		log.Printf("modkeeper: cannot open log file %s: %v", path, err)
		return func() {}
	}
	options.Logger = slog.New(slog.NewTextHandler(
		io.MultiWriter(os.Stderr, file),
		&slog.HandlerOptions{Level: slog.LevelInfo},
	))
	return func() { _ = file.Close() }
}

func logFilePath(configPath string) string {
	if configPath != "" {
		return filepath.Join(filepath.Dir(configPath), "modkeeper.log")
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(base, "Modkeeper", "modkeeper.log")
}

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
	closeLog := configureLogging(&options, appBackend.ConfigPath)
	defer closeLog()
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
	if smoke {
		go runNativeSmoke(app, window, smokeService)
	}
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
