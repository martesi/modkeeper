// Package logging builds the application logger: a file sink in the config
// directory, an optional stderr sink, and a filter for asset-server noise.
package logging

import (
	"context"
	"io"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
)

// bestEffortWriter reports success even when its sink fails. Logging must not
// turn a missing console or a full disk into an application error.
type bestEffortWriter struct{ writer io.Writer }

func (w bestEffortWriter) Write(p []byte) (int, error) {
	if w.writer != nil {
		_, _ = w.writer.Write(p)
	}
	return len(p), nil
}

// dropAssetServerNoise removes the asset server's per-request Info records so
// they cannot bury frontend diagnostics. Warnings and errors still pass.
type dropAssetServerNoise struct{ next slog.Handler }

func (h dropAssetServerNoise) Enabled(ctx context.Context, level slog.Level) bool {
	return h.next.Enabled(ctx, level)
}

func (h dropAssetServerNoise) Handle(ctx context.Context, record slog.Record) error {
	if record.Level == slog.LevelInfo &&
		(strings.Contains(record.Message, "[AssetFileServerFS]") ||
			strings.Contains(record.Message, "AssetServer")) {
		return nil
	}
	return h.next.Handle(ctx, record)
}

func (h dropAssetServerNoise) WithAttrs(attrs []slog.Attr) slog.Handler {
	return dropAssetServerNoise{next: h.next.WithAttrs(attrs)}
}

func (h dropAssetServerNoise) WithGroup(name string) slog.Handler {
	return dropAssetServerNoise{next: h.next.WithGroup(name)}
}

// New returns a logger that writes to the config directory and, when stderr is
// not nil, to stderr as well. The file is written first because Windows GUI
// builds have no console. It returns a nil logger when no file can be opened,
// so the caller keeps the framework default.
func New(configPath string, stderr io.Writer) (*slog.Logger, func()) {
	path := FilePath(configPath)
	if path == "" {
		log.Printf("modkeeper: no log file path available; logging to stderr only")
		return nil, func() {}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		log.Printf("modkeeper: cannot create log directory for %s: %v", path, err)
		return nil, func() {}
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		log.Printf("modkeeper: cannot open log file %s: %v", path, err)
		return nil, func() {}
	}
	sinks := []io.Writer{bestEffortWriter{writer: file}}
	if stderr != nil {
		sinks = append(sinks, bestEffortWriter{writer: stderr})
	}
	logger := slog.New(dropAssetServerNoise{next: slog.NewTextHandler(
		io.MultiWriter(sinks...),
		&slog.HandlerOptions{Level: slog.LevelInfo},
	)})
	return logger, func() { _ = file.Close() }
}

// FilePath returns modkeeper.log beside the config file, or in the user config
// directory when no config path is known.
func FilePath(configPath string) string {
	if configPath != "" {
		return filepath.Join(filepath.Dir(configPath), "modkeeper.log")
	}
	base, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(base, "Modkeeper", "modkeeper.log")
}
