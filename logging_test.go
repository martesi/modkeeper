//go:build !server

package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type failingWriter struct{ err error }

func (w failingWriter) Write([]byte) (int, error) { return 0, w.err }

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
	closeLog := configureLogging(
		&options,
		filepath.Join(dir, "config.toml"),
		io.Discard,
	)
	defer closeLog()
	if options.Logger == nil {
		t.Fatal("expected a configured logger")
	}
	options.Logger.Info("file-sink-smoke")
	assertLogContains(t, dir, "file-sink-smoke")
}

func TestConfigureLoggingKeepsTheFileWhenStderrFails(t *testing.T) {
	dir := t.TempDir()
	var options application.Options
	closeLog := configureLogging(
		&options,
		filepath.Join(dir, "config.toml"),
		failingWriter{err: errors.New("windowsgui has no console")},
	)
	defer closeLog()
	options.Logger.Info("file-sink-survives")
	assertLogContains(t, dir, "file-sink-survives")
}

func TestConfigureLoggingDropsAssetServerNoise(t *testing.T) {
	dir := t.TempDir()
	var options application.Options
	closeLog := configureLogging(
		&options,
		filepath.Join(dir, "config.toml"),
		io.Discard,
	)
	defer closeLog()
	options.Logger.Info("[AssetFileServerFS] Handling request", "url", "/")
	options.Logger.Info("AssetServer Info:", "middleware", true)
	options.Logger.Info("frontend diagnostic")
	content := readLog(t, dir)
	if strings.Contains(content, "AssetFileServerFS") ||
		strings.Contains(content, "AssetServer Info") {
		t.Fatalf("asset server noise reached the log file: %s", content)
	}
	if !strings.Contains(content, "frontend diagnostic") {
		t.Fatalf("frontend diagnostic missing from log file: %s", content)
	}
}

func assertLogContains(t *testing.T, dir, want string) {
	t.Helper()
	if content := readLog(t, dir); !strings.Contains(content, want) {
		t.Fatalf("log file does not contain %q: %s", want, content)
	}
}

func readLog(t *testing.T, dir string) string {
	t.Helper()
	content, err := os.ReadFile(filepath.Join(dir, "modkeeper.log"))
	if err != nil {
		t.Fatal(err)
	}
	return string(content)
}
