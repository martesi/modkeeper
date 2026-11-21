// Package registry owns stable library registration and settings persistence.
package registry

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/config"
	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/process"
	"github.com/martes/modkeeper/backend/store"
)

type Service struct{ Store *store.AppConfigStore }

// TaskRegistry protects long-running task IDs and the active library handle.
// Library remains an interface here so registry does not depend on library.
type TaskRegistry struct {
	mu          sync.Mutex
	tasks       map[string]taskEntry
	activeID    string
	active      bool
	startup     chan struct{}
	startupErr  error
	startupOnce sync.Once
}

type taskEntry struct {
	libraryID   string
	cancel      context.CancelFunc
	cancelled   bool
	cancellable bool
}

func NewTaskRegistry() *TaskRegistry {
	return &TaskRegistry{tasks: make(map[string]taskEntry), startup: make(chan struct{})}
}

func (r *TaskRegistry) SetActive(id string, active bool) {
	r.mu.Lock()
	r.activeID, r.active = id, active
	r.mu.Unlock()
}

func (r *TaskRegistry) AssertActiveLibrary(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.active {
		return models.Fail(models.NoActiveLibrary)
	}
	if r.activeID != id {
		return models.Fail(models.InvalidLibrary, id)
	}
	return nil
}

func (r *TaskRegistry) AcquireTaskID(id string) error {
	return r.AcquireTask(id, "", func() {})
}

func (r *TaskRegistry) AcquireTask(id, libraryID string, cancel context.CancelFunc) error {
	return r.AcquireTaskWithCancellable(id, libraryID, cancel, true)
}

func (r *TaskRegistry) AcquireTaskWithCancellable(id, libraryID string, cancel context.CancelFunc, cancellable bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if id == "" {
		return models.Fail(models.ParseError, "taskId is required")
	}
	if _, exists := r.tasks[id]; exists {
		return models.Fail(models.TaskIdInUse, id)
	}
	r.tasks[id] = taskEntry{libraryID: libraryID, cancel: cancel, cancellable: cancellable}
	return nil
}

func (r *TaskRegistry) CancelTask(id, libraryID string) error {
	if id == "" {
		return models.Fail(models.ParseError, "taskId is required")
	}
	r.mu.Lock()
	entry, exists := r.tasks[id]
	if !exists {
		r.mu.Unlock()
		return models.Fail(models.TaskNotFound, id)
	}
	if entry.libraryID != libraryID {
		r.mu.Unlock()
		return models.Fail(models.InvalidLibrary, libraryID)
	}
	if !entry.cancellable {
		r.mu.Unlock()
		return models.Fail(models.TaskNotCancellable, id)
	}
	if entry.cancelled {
		r.mu.Unlock()
		return models.Fail(models.TaskAlreadyCancelled, id)
	}
	entry.cancelled = true
	r.tasks[id] = entry
	r.mu.Unlock()
	// Call the cancel func captured under the lock. Re-reading the entry after
	// unlocking could cancel a different task that reused the same id.
	entry.cancel()
	return nil
}

func (r *TaskRegistry) FinishTaskID(id string) {
	r.mu.Lock()
	delete(r.tasks, id)
	r.mu.Unlock()
}

func (r *TaskRegistry) FinishStartupLoad(err error) {
	r.startupOnce.Do(func() {
		r.startupErr = err
		close(r.startup)
	})
}

func (r *TaskRegistry) WaitForStartupLoad(ctx context.Context) error {
	timer := time.NewTimer(10 * time.Second)
	defer timer.Stop()
	select {
	case <-r.startup:
		return r.startupErr
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return fmt.Errorf("initial library load timed out")
	}
}

// ProcessGuard protects destructive operations from running game/server
// processes. Inspection errors are propagated and never treated as safe.
type ProcessGuard struct{ Inspector process.Inspector }

func (g ProcessGuard) AssertStopped(paths []string, code string) error {
	running, err := g.Inspector.IsRunning(paths)
	if err != nil {
		return fmt.Errorf("inspect running processes: %w", err)
	}
	if running {
		return models.Fail(code)
	}
	return nil
}

func (s *Service) GetSettings() config.AppSettings { return s.Store.Config.Settings }
func (s *Service) SaveSettings(settings config.AppSettings) (config.AppSettings, error) {
	old := s.Store.Config.Settings
	s.Store.Config.Settings = settings
	s.Store.Config.Normalize()
	if err := s.Store.Save(); err != nil {
		s.Store.Config.Settings = old
		return config.AppSettings{}, err
	}
	return s.Store.Config.Settings, nil
}

// MigrateLegacy adopts stable IDs from manifest.toml when available. It does
// not open or validate a library. The limited TOML scan intentionally reads
// only the manifest's top-level id field.
func MigrateLegacy(paths []string, activePath string) config.AppConfig {
	cfg := config.Default()
	for _, path := range paths {
		id := manifestID(filepath.Join(path, "manifest.toml"))
		if id == "" {
			id = config.NewID()
		}
		cfg.UpsertLibrary(config.KnownLibrary{ID: id, LibraryRoot: path})
		if filepath.Clean(activePath) == filepath.Clean(path) {
			active := id
			cfg.AppState.ActiveLibraryID = &active
		}
	}
	return cfg
}

func manifestID(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var raw map[string]any
	// Keep manifest parsing intentionally conservative: manifests are TOML.
	if _, err := toml.Decode(string(b), &raw); err != nil {
		return ""
	}
	id, _ := raw["id"].(string)
	return id
}

func (s *Service) Register(id, root string) error {
	if id == "" || root == "" {
		return fmt.Errorf("library id and root are required")
	}
	s.Store.Config.UpsertLibrary(config.KnownLibrary{ID: id, LibraryRoot: root})
	return s.Store.Save()
}
