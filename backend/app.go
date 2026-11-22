package backend

import (
	"os"

	"github.com/martes/modkeeper/backend/forge"
	"github.com/martes/modkeeper/backend/library"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/store"
)

// App is the Wails-bound application object. Construction loads the persisted
// config and prepares the library service; Start performs the work that must
// wait for Wails to be ready (recovery, background library load).
type App struct {
	Library    *library.Service
	Forge      *forge.Service
	ConfigPath string
	// Sink receives progress and workspace events once Start runs. It is a
	// struct field, not a bound method, because Wails cannot serialize function
	// arguments.
	Sink EventSink
	// InitErr is reported by every command when construction failed, instead of
	// panicking on a nil service.
	InitErr error
}

// EventSink is the application event bus used by long-running operations.
type EventSink interface {
	Progress(models.TaskProgressEvent) error
	Workspace(models.WorkspaceEvent) error
}

func NewApp() *App {
	path, err := store.ConfigPath(os.Getenv("MODKEEPER_DEBUG") == "1")
	if err != nil {
		return &App{InitErr: err}
	}
	return NewAppAt(path)
}

// NewAppAt builds the app against an explicit config path. Tests use it to avoid
// the user's real config directory.
func NewAppAt(path string) *App {
	service, err := library.New(path)
	if err != nil {
		return &App{ConfigPath: path, InitErr: err}
	}
	forgeService := forge.NewService(nil, service.ActiveSPTVersion)
	forgeService.Hooks = service.ForgeInstallHooks()
	return &App{Library: service, Forge: forgeService, ConfigPath: path}
}

// Start runs startup recovery and kicks the background active-library load. It
// never blocks the Wails event loop and is safe to call in tests.
func (a *App) Start() error {
	if a.InitErr != nil {
		return a.InitErr
	}
	if a.Library == nil {
		return nil
	}
	if a.Sink != nil {
		a.Library.SetEventSenders(a.Sink.Progress, a.Sink.Workspace)
	}
	return a.Library.Start()
}

// ApplyWindowEffect is a compatibility no-op. Wails applies the window backdrop
// and appearance when it creates the window, and has no runtime setter, so
// main.go seeds both from the saved theme at startup. Returning success keeps
// the existing frontend call path working when the user changes theme later.
func (a *App) ApplyWindowEffect(isDark *bool) error { return nil }
