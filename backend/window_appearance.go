package backend

import (
	"github.com/martes/modkeeper/backend/config"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// WindowAppearance is the native window appearance derived from the saved
// theme. Wails applies the backdrop and appearance when it creates the window
// and exposes no runtime setter, so the desktop entrypoint reads this once at
// startup instead of reacting to later theme changes.
type WindowAppearance struct {
	Theme         application.Theme
	MacAppearance application.MacAppearanceType
}

// WindowAppearanceFor maps a persisted theme to Wails window options. System
// keeps following the OS theme; light and dark pin the appearance.
func WindowAppearanceFor(theme config.ThemeMode) WindowAppearance {
	switch theme {
	case config.ThemeDark:
		return WindowAppearance{
			Theme:         application.Dark,
			MacAppearance: application.NSAppearanceNameDarkAqua,
		}
	case config.ThemeLight:
		return WindowAppearance{
			Theme:         application.Light,
			MacAppearance: application.NSAppearanceNameAqua,
		}
	default:
		return WindowAppearance{
			Theme:         application.SystemDefault,
			MacAppearance: application.DefaultAppearance,
		}
	}
}
