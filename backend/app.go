package backend

import "github.com/martes/modkeeper/backend/library"

// App is the Wails-bound application object.
type App struct{ Library *library.Service }

func NewApp() *App                            { return &App{} }
func (a *App) ApplyWindowEffect(isDark *bool) {}
