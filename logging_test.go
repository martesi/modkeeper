//go:build !server

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestLogFilePathUsesTheConfigDirectory(t *testing.T) {
	got := logFilePath(filepath.Join("/tmp", "Modkeeper", "config.toml"))
	want := filepath.Join("/tmp", "Modkeeper", "modkeeper.log")
	if got != want {
		t.Fatalf("log path = %q, want %q", got, want)
	}
}

func TestConfigureLoggingWritesToTheConfigDirectory(t *testing.T) {
	dir := t.TempDir()
	var options application.Options
	closeLog := configureLogging(&options, filepath.Join(dir, "config.toml"))
	defer closeLog()
	if options.Logger == nil {
		t.Fatal("expected a configured logger")
	}
	options.Logger.Info("file-sink-smoke")
	content, err := os.ReadFile(filepath.Join(dir, "modkeeper.log"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(content), "file-sink-smoke") {
		t.Fatalf("log file does not contain the diagnostic: %s", content)
	}
}
