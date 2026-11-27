package linker

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// Mode controls which artifact kinds may be considered by the probe.
type Mode string

const (
	AutomaticMode Mode = "automatic"
	LinkMode      Mode = "link"
	CopyMode      Mode = "copy"
)

// Consumer identifies the process that must be able to read deployed files.
type Consumer string

const (
	NativeConsumer  Consumer = "manager-native"
	WindowsConsumer Consumer = "windows"
	UnknownConsumer Consumer = "unknown"
)

// WindowsReader reads a manager-visible path through the Windows consumer.
// Implementations return ErrConsumerUnavailable when the artifact is inaccessible;
// other errors report operational failures.
type WindowsReader func(path string) ([]byte, error)

// ErrConsumerUnavailable reports that a consumer cannot access an artifact.
var ErrConsumerUnavailable = errors.New("consumer cannot access artifact")

type ProbeOptions struct {
	Mode          Mode
	Consumer      Consumer
	WindowsReader WindowsReader
}

// Capabilities contains verified kinds. An empty kind means unavailable or
// unknown; an empty Directory permits ordinary directories with linked files.
type Capabilities struct {
	File      ArtifactKind
	Directory ArtifactKind
}

// Probe tests scratch artifacts on the filesystems containing sourceDir and
// targetDir. Call separately for each actual source/destination directory pair;
// the result is not a guarantee for other mounts or later filesystem changes.
func Probe(sourceDir, targetDir string, options ProbeOptions) (Capabilities, error) {
	return probe(sourceDir, targetDir, options, Create)
}

func probe(sourceDir, targetDir string, options ProbeOptions, create func(string, string, ArtifactKind) error) (result Capabilities, err error) {
	return probeWithCleanup(sourceDir, targetDir, options, create, os.RemoveAll)
}

func probeWithCleanup(sourceDir, targetDir string, options ProbeOptions, create func(string, string, ArtifactKind) error, removeAll func(string) error) (result Capabilities, err error) {
	if sourceDir == "" || targetDir == "" {
		return result, errors.New("probe source and target directories must not be empty")
	}
	if options.Mode != AutomaticMode && options.Mode != LinkMode && options.Mode != CopyMode {
		return result, fmt.Errorf("invalid probe mode %q", options.Mode)
	}
	var read func(string) ([]byte, error)
	switch options.Consumer {
	case NativeConsumer:
		read = os.ReadFile
	case WindowsConsumer:
		read = options.WindowsReader
		if read == nil && runtime.GOOS == "windows" {
			read = os.ReadFile
		}
	case UnknownConsumer:
	default:
		return result, fmt.Errorf("invalid consumer %q", options.Consumer)
	}
	if read == nil {
		return result, nil
	}
	sourceDir, err = filepath.Abs(sourceDir)
	if err != nil {
		return result, fmt.Errorf("resolve probe source directory: %w", err)
	}
	source, err := os.MkdirTemp(sourceDir, ".deployment-probe-")
	if err != nil {
		return result, fmt.Errorf("create probe source: %w", err)
	}
	defer func() {
		if e := removeAll(source); e != nil {
			err = errors.Join(err, fmt.Errorf("clean probe source %s: %w", source, e))
		}
	}()
	target, err := os.MkdirTemp(targetDir, ".deployment-probe-")
	if err != nil {
		return result, fmt.Errorf("create probe target: %w", err)
	}
	defer func() {
		if e := removeAll(target); e != nil {
			err = errors.Join(err, fmt.Errorf("clean probe target %s: %w", target, e))
		}
	}()
	sentinel := []byte("modkeeper capability probe\n")
	file := filepath.Join(source, "file")
	dir := filepath.Join(source, "directory")
	if err = os.WriteFile(file, sentinel, 0600); err != nil {
		return result, fmt.Errorf("write probe file: %w", err)
	}
	if err = os.Mkdir(dir, 0700); err != nil {
		return result, fmt.Errorf("create probe directory: %w", err)
	}
	if err = os.WriteFile(filepath.Join(dir, "sentinel"), sentinel, 0600); err != nil {
		return result, fmt.Errorf("write probe directory sentinel: %w", err)
	}
	files := []ArtifactKind{Symlink, Hardlink}
	dirs := []ArtifactKind{Symlink} // Junction needs a real reparse-point provider.
	if options.Mode == CopyMode {
		files, dirs = []ArtifactKind{Copy}, []ArtifactKind{Copy}
	}
	if options.Mode == AutomaticMode {
		files = append(files, Copy)
		dirs = append(dirs, Copy)
	}
	check := func(src, dst string, kinds []ArtifactKind, directory bool) (ArtifactKind, error) {
		for _, kind := range kinds {
			if e := create(src, dst, kind); e != nil {
				if capabilityUnavailable(e) {
					continue
				}
				return "", fmt.Errorf("create %s probe artifact %s: %w", kind, dst, e)
			}
			valid := true
			if kind == Hardlink {
				a, e := os.Stat(src)
				if e != nil {
					return "", fmt.Errorf("stat hardlink source %s: %w", src, e)
				}
				b, e := os.Stat(dst)
				if e != nil {
					return "", fmt.Errorf("stat hardlink target %s: %w", dst, e)
				}
				valid = os.SameFile(a, b)
			}
			readPath := dst
			if directory {
				readPath = filepath.Join(dst, "sentinel")
				if kind == Copy {
					if e := os.WriteFile(readPath, sentinel, 0600); e != nil {
						return "", fmt.Errorf("write copied directory sentinel %s: %w", readPath, e)
					}
				}
			}
			data, e := read(readPath)
			if e != nil && !errors.Is(e, ErrConsumerUnavailable) {
				return "", fmt.Errorf("read %s probe artifact %s: %w", kind, readPath, e)
			}
			valid = valid && e == nil && bytes.Equal(data, sentinel)
			if e = removeAll(dst); e != nil {
				return "", fmt.Errorf("clean probe artifact %s: %w", dst, e)
			}
			if valid {
				return kind, nil
			}
		}
		return "", nil
	}
	result.File, err = check(file, filepath.Join(target, "file"), files, false)
	if err != nil {
		return result, err
	}
	result.Directory, err = check(dir, filepath.Join(target, "directory"), dirs, true)
	return result, err
}
