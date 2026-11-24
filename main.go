package main

import (
	"embed"
	"log"
	"os"
	"runtime"
	"strconv"

	"github.com/martes/modkeeper/backend"
	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/logging"
	"github.com/martes/modkeeper/backend/models"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

func main() {
	appBackend := backend.NewApp()
	// Wails needs a default marshaler to preserve the backend's coded errors.
	// Keep the concrete service visible to the Wails bindings generator.
	application.DefaultServiceOptions.MarshalError = backend.MarshalError
	options := application.Options{
		Name:        "Modkeeper",
		Description: "Game mod management and development",
		Services:    []application.Service{application.NewService(appBackend)},
		Assets:      application.AssetOptions{Handler: application.AssetFileServerFS(frontend)},
	}
	// Logging and server options must be selected before application.New.
	if serverBuild {
		options.Server = serverOptions()
	} else {
		logger, closeLog := logging.New(appBackend.ConfigPath, os.Stderr)
		defer closeLog()
		if logger != nil {
			options.Logger = logger
		}
	}
	app := application.New(options)
	if !serverBuild {
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
	}
	if appBackend.InitErr != nil {
		log.Printf("modkeeper: config/library initialization failed: %v", appBackend.InitErr)
	} else {
		appBackend.Sink = wailsEventSink{app: app}
		if err := appBackend.Start(); err != nil {
			log.Printf("modkeeper: startup load failed: %v", err)
		}
	}
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

//go:embed all:dist
var frontend embed.FS

// fileDropEvent carries native window drops to the renderer. The name stays
// outside the framework's reserved `common:` namespace.
const fileDropEvent = "modkeeper:files-dropped"

func init() {
	application.RegisterEvent[models.TaskProgressEvent]("task_progress")
	application.RegisterEvent[any]("workspace-event")
	application.RegisterEvent[models.WindowFilesDroppedEvent](fileDropEvent)
}

// dropTarget converts Wails' drop context to the backend's plain type.
func dropTarget(target *application.DropTargetDetails) *backend.DropTarget {
	if target == nil {
		return nil
	}
	return &backend.DropTarget{
		X:          target.X,
		Y:          target.Y,
		ElementID:  target.ElementID,
		ClassList:  target.ClassList,
		Attributes: target.Attributes,
	}
}

// forwardWindowFileDrops re-emits Wails' window file-drop event on the JS
// event bus. Wails delivers `common:WindowFilesDropped` to Go window listeners
// only, so the renderer cannot subscribe to it directly.
func forwardWindowFileDrops(window *application.WebviewWindow) {
	window.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		files := event.Context().DroppedFiles()
		target := event.Context().DropTargetDetails()
		// Emit from this window so the payload carries the source window.
		// Wails v3.1.0 still fans the event out through the application event
		// bus, so another window would receive this drop too; consumers must
		// filter on Sender when that matters.
		if window.EmitEvent(fileDropEvent, backend.WindowFilesDroppedPayload(files, dropTarget(target))) {
			log.Printf("modkeeper: file-drop event was cancelled")
		}
	})
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

// serverOptions is the server-mode bind configuration. It lives in Go so the
// defaults are visible next to the entrypoint that uses them; the environment
// only overrides them for ad-hoc runs and the dev task.
func serverOptions() application.ServerOptions {
	options := application.ServerOptions{
		Host: "127.0.0.1",
		Port: 8080,
	}
	if host := os.Getenv("MODKEEPER_SERVER_HOST"); host != "" {
		options.Host = host
	}
	if port := os.Getenv("MODKEEPER_SERVER_PORT"); port != "" {
		parsed, err := strconv.Atoi(port)
		if err != nil {
			log.Printf("modkeeper: ignoring invalid MODKEEPER_SERVER_PORT %q: %v", port, err)
		} else {
			options.Port = parsed
		}
	}
	return options
}
