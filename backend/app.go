package backend

// App is the Wails-bound application object. Service methods are added here as
// their Rust command contracts are ported; startup remains independent of Wails.
type App struct{}

func NewApp() *App { return &App{} }

func (a *App) ApplyWindowEffect(isDark *bool) {}

func (a *App) GetLibraryWorkspace() (any, error) { return nil, failure("NoActiveLibrary", nil) }
func (a *App) ActivateLibrary(input map[string]any) (any, error) { return nil, failure("NoActiveLibrary", nil) }
func (a *App) CreateLibrary(input map[string]any) (any, error) { return nil, failure("Unexpected", "library service not initialized") }
func (a *App) GetSettings() (any, error) { return map[string]any{}, nil }
func (a *App) SaveSettings(settings map[string]any) (any, error) { return settings, nil }
func (a *App) RenameLibrary(input map[string]any) (any, error) { return nil, failure("NoActiveLibrary", nil) }
func (a *App) DeleteLibrary(input map[string]any) (any, error) { return nil, failure("NoActiveLibrary", nil) }
func (a *App) BulkUpdateMods(input map[string]any) (any, error) { return nil, failure("NoActiveLibrary", nil) }
func (a *App) SyncMods(input map[string]any) (any, error) { return nil, failure("NoActiveLibrary", nil) }
func (a *App) InstallModArchives(input map[string]any) (any, error) { return nil, failure("NoActiveLibrary", nil) }
func (a *App) RebuildLibraryCache(input map[string]any) (any, error) { return nil, failure("NoActiveLibrary", nil) }
