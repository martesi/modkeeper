//go:build !server

package main

import (
	"context"
	"io"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/martes/modkeeper/backend"
	"github.com/martes/modkeeper/backend/config"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// bestEffortWriter reports success even when its sink fails. Logging must not
// turn a missing console or a full disk into an application error.
type bestEffortWriter struct{ writer io.Writer }

func (w bestEffortWriter) Write(p []byte) (int, error) {
	if w.writer != nil {
		_, _ = w.writer.Write(p)
	}
	return len(p), nil
}

// dropAssetServerNoise removes the asset server's per-request Info records so
// they cannot bury frontend diagnostics. Warnings and errors still pass.
type dropAssetServerNoise struct{ next slog.Handler }

func (h dropAssetServerNoise) Enabled(ctx context.Context, level slog.Level) bool {
	return h.next.Enabled(ctx, level)
}

func (h dropAssetServerNoise) Handle(ctx context.Context, record slog.Record) error {
	if record.Level == slog.LevelInfo &&
		(strings.Contains(record.Message, "[AssetFileServerFS]") ||
			strings.Contains(record.Message, "AssetServer")) {
		return nil
	}
	return h.next.Handle(ctx, record)
}

func (h dropAssetServerNoise) WithAttrs(attrs []slog.Attr) slog.Handler {
	return dropAssetServerNoise{next: h.next.WithAttrs(attrs)}
}

func (h dropAssetServerNoise) WithGroup(name string) slog.Handler {
	return dropAssetServerNoise{next: h.next.WithGroup(name)}
}

// configureLogging gives the Wails application logger a file sink in the config
// directory. The frontend Log bound method writes through this logger, which is
// the Wails counterpart to Tauri's log plugin. The file is written before the
// optional stderr sink because Windows GUI builds have no console.
func configureLogging(options *application.Options, configPath string, stderr io.Writer) func() {
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
	sinks := []io.Writer{bestEffortWriter{writer: file}}
	if stderr != nil {
		sinks = append(sinks, bestEffortWriter{writer: stderr})
	}
	options.Logger = slog.New(dropAssetServerNoise{next: slog.NewTextHandler(
		io.MultiWriter(sinks...),
		&slog.HandlerOptions{Level: slog.LevelInfo},
	)})
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
	closeLog := configureLogging(&options, appBackend.ConfigPath, os.Stderr)
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
