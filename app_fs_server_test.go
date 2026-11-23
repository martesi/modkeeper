//go:build server

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/martes/modkeeper/backend"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestServerFilesystemMethodsOverWailsTransport(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "archive.zip"), nil, 0o600); err != nil {
		t.Fatal(err)
	}

	port := freeTCPPort(t)
	options := appOptions(&backend.App{})
	options.Server = application.ServerOptions{Host: "127.0.0.1", Port: port}
	app := application.New(options)
	errCh := make(chan error, 1)
	go func() { errCh <- app.Run() }()
	t.Cleanup(func() {
		app.Quit()
		select {
		case err := <-errCh:
			if err != nil {
				t.Errorf("server exited with error: %v", err)
			}
		case <-time.After(3 * time.Second):
			t.Error("server did not stop")
		}
	})

	baseURL := "http://127.0.0.1:" + strconv.Itoa(port)
	waitForServer(t, baseURL)

	var home string
	callWailsMethod(t, baseURL, "github.com/martes/modkeeper/backend.App.HomeDirectory", nil, &home)
	if home == "" {
		t.Fatal("HomeDirectory returned an empty path")
	}

	var entries []backend.DirectoryEntry
	callWailsMethod(t, baseURL, "github.com/martes/modkeeper/backend.App.ListDirectory", []string{root}, &entries)
	if len(entries) != 2 || entries[0].Name != "archive.zip" || entries[0].IsDir || entries[1].Name != "folder" || !entries[1].IsDir {
		t.Fatalf("unexpected serialized ListDirectory entries: %+v", entries)
	}
}

func freeTCPPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}

func waitForServer(t *testing.T, baseURL string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		resp, err := http.Get(baseURL + "/health")
		if err == nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatal("server did not become healthy")
}

func callWailsMethod(t *testing.T, baseURL, method string, args []string, result any) {
	t.Helper()
	requestBody, err := json.Marshal(map[string]any{
		"object": 0,
		"method": 0,
		"args": map[string]any{
			"call-id":    fmt.Sprintf("filesystem-%d", time.Now().UnixNano()),
			"methodName": method,
			"args":       args,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.Post(baseURL+"/wails/runtime", "application/json", bytes.NewReader(requestBody))
	if err != nil {
		t.Fatalf("call %s over Wails transport: %v", method, err)
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read %s response: %v", method, err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("call %s returned %s: %s", method, resp.Status, responseBody)
	}
	if target, ok := result.(*string); ok {
		*target = string(responseBody)
		return
	}
	if err := json.Unmarshal(responseBody, result); err != nil {
		t.Fatalf("decode %s response %q: %v", method, responseBody, err)
	}
}
