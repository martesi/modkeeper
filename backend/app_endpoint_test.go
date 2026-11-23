package backend

import (
	"path/filepath"
	"testing"
)

func TestForgeEndpointTracksPersistedSetting(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "config.toml")
	app := NewAppAt(configPath)
	if app.InitErr != nil {
		t.Fatal(app.InitErr)
	}

	settings, err := app.GetSettings()
	if err != nil {
		t.Fatal(err)
	}
	settings.ForgeEndpoint = "https://forge.example/api/v0"
	if _, err = app.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	if got := app.Forge.Endpoint(); got != settings.ForgeEndpoint {
		t.Fatalf("service endpoint %q, want persisted setting %q", got, settings.ForgeEndpoint)
	}

	restarted := NewAppAt(configPath)
	if restarted.InitErr != nil {
		t.Fatal(restarted.InitErr)
	}
	if got := restarted.Forge.Endpoint(); got != settings.ForgeEndpoint {
		t.Fatalf("reloaded service endpoint %q, want persisted setting %q", got, settings.ForgeEndpoint)
	}
}
