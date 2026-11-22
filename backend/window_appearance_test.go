package backend

import (
	"testing"

	"github.com/martes/modkeeper/backend/config"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestWindowAppearanceFollowsSavedTheme(t *testing.T) {
	tests := []struct {
		theme     config.ThemeMode
		wantTheme application.Theme
		wantMac   application.MacAppearanceType
	}{
		{
			theme:     config.ThemeDark,
			wantTheme: application.Dark,
			wantMac:   application.NSAppearanceNameDarkAqua,
		},
		{
			theme:     config.ThemeLight,
			wantTheme: application.Light,
			wantMac:   application.NSAppearanceNameAqua,
		},
		{
			theme:     config.ThemeSystem,
			wantTheme: application.SystemDefault,
			wantMac:   application.DefaultAppearance,
		},
	}
	for _, test := range tests {
		t.Run(string(test.theme), func(t *testing.T) {
			got := WindowAppearanceFor(test.theme)
			if got.Theme != test.wantTheme {
				t.Fatalf("theme = %v, want %v", got.Theme, test.wantTheme)
			}
			if got.MacAppearance != test.wantMac {
				t.Fatalf("mac appearance = %q, want %q", got.MacAppearance, test.wantMac)
			}
		})
	}
}
