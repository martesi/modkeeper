package main

import (
	"embed"
	"log"

	"github.com/martes/modkeeper/backend"
	"github.com/martes/modkeeper/backend/models"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

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

// appOptions builds the application.Options shared by the desktop entrypoint
// (main.go) and the headless server entrypoint (main_server.go), so services,
// embedded assets and event wiring cannot drift between the two. Callers add
// mode-specific services and options, then pass the result to application.New.
func appOptions(appBackend *backend.App) application.Options {
	// Wails serializes the concrete error value unless a service marshaler is
	// set, so an uncoded error becomes "{}" and the bridge reports a transport
	// failure. The backend keeps every command failure on the {code, data}
	// wire contract. ServiceOptions cannot be passed through NewService without
	// hiding the call from the bindings generator, so use the documented
	// default instead.
	application.DefaultServiceOptions.MarshalError = backend.MarshalError
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

// dropPayload maps Wails' native drop context to the renderer event payload.
func dropPayload(files []string, target *application.DropTargetDetails) models.WindowFilesDroppedEvent {
	payload := models.WindowFilesDroppedEvent{Filenames: files}
	if target == nil {
		return payload
	}
	payload.X = target.X
	payload.Y = target.Y
	payload.ElementDetails = models.WindowDropElementDetails{
		ID:         target.ElementID,
		ClassList:  target.ClassList,
		Attributes: target.Attributes,
	}
	return payload
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
		if window.EmitEvent(fileDropEvent, dropPayload(files, target)) {
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
