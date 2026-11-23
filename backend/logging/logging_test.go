package logging

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type failingWriter struct{ err error }

func (w failingWriter) Write([]byte) (int, error) { return 0, w.err }

func TestFilePathUsesTheConfigDirectory(t *testing.T) {
	got := FilePath(filepath.Join("/tmp", "Modkeeper", "config.toml"))
	want := filepath.Join("/tmp", "Modkeeper", "modkeeper.log")
	if got != want {
		t.Fatalf("log path = %q, want %q", got, want)
	}
}

func TestNewWritesToTheConfigDirectory(t *testing.T) {
	dir := t.TempDir()
	logger, closeLog := New(filepath.Join(dir, "config.toml"), io.Discard)
	defer closeLog()
	if logger == nil {
		t.Fatal("expected a logger")
	}
	logger.Info("file-sink-smoke")
	assertLogContains(t, dir, "file-sink-smoke")
}

func TestNewKeepsTheFileWhenStderrFails(t *testing.T) {
	dir := t.TempDir()
	logger, closeLog := New(
		filepath.Join(dir, "config.toml"),
		failingWriter{err: errors.New("windowsgui has no console")},
	)
	defer closeLog()
	logger.Info("file-sink-survives")
	assertLogContains(t, dir, "file-sink-survives")
}

func TestNewDropsAssetServerNoise(t *testing.T) {
	dir := t.TempDir()
	logger, closeLog := New(filepath.Join(dir, "config.toml"), io.Discard)
	defer closeLog()
	logger.Info("[AssetFileServerFS] Handling request", "url", "/")
	logger.Info("AssetServer Info:", "middleware", true)
	logger.Info("frontend diagnostic")
	content := readLog(t, dir)
	if strings.Contains(content, "AssetFileServerFS") ||
		strings.Contains(content, "AssetServer Info") {
		t.Fatalf("asset server noise reached the log file: %s", content)
	}
	if !strings.Contains(content, "frontend diagnostic") {
		t.Fatalf("frontend diagnostic missing from log file: %s", content)
	}
}

func TestNewKeepsAssetServerWarnings(t *testing.T) {
	dir := t.TempDir()
	logger, closeLog := New(filepath.Join(dir, "config.toml"), io.Discard)
	defer closeLog()
	logger.Warn("AssetServer failed to serve")
	if content := readLog(t, dir); !strings.Contains(content, "AssetServer failed to serve") {
		t.Fatalf("asset server warning was dropped: %s", content)
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
