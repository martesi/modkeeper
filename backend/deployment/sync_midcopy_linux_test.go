//go:build linux

package deployment

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/spt"
	"golang.org/x/sys/unix"
)

func TestSyncCopyCrashChild(t *testing.T) {
	if os.Getenv("MODKEEPER_SYNC_COPY_CHILD") != "1" {
		return
	}
	l := Layout{LibraryRoot: os.Getenv("MODKEEPER_SYNC_LIBRARY"), GameRoot: os.Getenv("MODKEEPER_SYNC_GAME")}
	var err error
	l.Rules, err = spt.Discover(l.GameRoot)
	if err != nil {
		t.Fatal(err)
	}
	_, err = syncWithHooks(context.Background(), l, []models.Mod{{ID: "a", Enabled: true}}, nil, nil, func(boundary string) error {
		if boundary == "pre-publication" {
			_, _ = fmt.Fprintln(os.Stdout, "COPY_CHILD_READY")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestSyncKillDuringCopyLeavesStageAndIntent(t *testing.T) {
	l := fixture(t)
	source := filepath.Join(l.Paths().Mods, "a/BepInEx/plugins/a.dll")
	write(t, source, "placeholder")
	if err := os.Remove(source); err != nil {
		t.Fatal(err)
	}
	if err := unix.Mkfifo(source, 0600); err != nil {
		t.Fatal(err)
	}

	command := exec.Command(os.Args[0], "-test.run=^TestSyncCopyCrashChild$")
	command.Env = append(os.Environ(),
		"MODKEEPER_SYNC_COPY_CHILD=1",
		"MODKEEPER_SYNC_LIBRARY="+l.LibraryRoot,
		"MODKEEPER_SYNC_GAME="+l.GameRoot,
	)
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr strings.Builder
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	killAndWait := func() {
		if command.Process != nil {
			_ = command.Process.Kill()
			_ = command.Wait()
		}
	}
	t.Cleanup(killAndWait)

	ready := false
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		if scanner.Text() == "COPY_CHILD_READY" {
			ready = true
			break
		}
	}
	if !ready {
		t.Fatalf("copy child did not reach publication: %v; stderr=%s", scanner.Err(), stderr.String())
	}

	intents, err := readSyncIntentRecords(l.Paths().SyncIntent)
	if err != nil || len(intents) == 0 {
		t.Fatalf("read durable intent before copy: %v", err)
	}
	intent := intents[len(intents)-1]
	stage := ""
	for _, target := range intent.Targets {
		if target.Stage != "" {
			stage = filepath.Join(l.GameRoot, target.Stage)
			break
		}
	}
	if stage == "" {
		t.Fatal("durable intent did not name the copy stage")
	}

	writerReady := make(chan *os.File, 1)
	writerErr := make(chan error, 1)
	go func() {
		file, openErr := os.OpenFile(source, os.O_WRONLY, 0)
		if openErr != nil {
			writerErr <- openErr
			return
		}
		writerReady <- file
	}()
	var writer *os.File
	select {
	case writer = <-writerReady:
	case err := <-writerErr:
		t.Fatalf("open FIFO writer: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("copy process did not open the FIFO source")
	}
	payload := bytes.Repeat([]byte("foreign-copy-chunk-"), 256*1024)
	if _, err := writer.Write(payload); err != nil {
		_ = writer.Close()
		t.Fatalf("write copy payload: %v", err)
	}
	defer writer.Close()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		info, err := os.Stat(stage)
		if err == nil && info.Size() == int64(len(payload)) {
			break
		}
		time.Sleep(time.Millisecond)
	}
	info, err := os.Stat(stage)
	if err != nil || info.Size() != int64(len(payload)) {
		t.Fatalf("copy did not stop mid-stream with tracked partial stage: size=%v err=%v", fileSize(info), err)
	}
	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	if err := command.Wait(); err == nil {
		t.Fatal("mid-copy child exited without being killed")
	}
	command.Process = nil
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	target := filepath.Join(l.GameRoot, "BepInEx/plugins/a.dll")
	absent(t, target)
	sentinel := filepath.Join(l.GameRoot, "unrelated-sentinel")
	write(t, sentinel, "keep")
	stageBytes, err := os.ReadFile(stage)
	if err != nil || !bytes.Equal(stageBytes, payload) {
		t.Fatalf("partial stage changed after process kill: size=%d err=%v", len(stageBytes), err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		_, err := Sync(context.Background(), l, []models.Mod{{ID: "a", Enabled: true}}, nil)
		code(t, err, "FileCollision")
		content(t, sentinel, "keep")
		stageBytes, err = os.ReadFile(stage)
		if err != nil || !bytes.Equal(stageBytes, payload) {
			t.Fatalf("recovery changed partial stage: size=%d err=%v", len(stageBytes), err)
		}
		if _, err := os.Lstat(l.Paths().SyncIntent); err != nil {
			t.Fatalf("recovery removed the staging blocker: %v", err)
		}
	}
}

func fileSize(info os.FileInfo) int64 {
	if info == nil {
		return -1
	}
	return info.Size()
}
