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
	"os/exec"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/martes/modkeeper/backend"
)

func TestServerStartupProcess(t *testing.T) {
	if os.Getenv("MODKEEPER_TEST_SERVER_PROCESS") == "1" {
		main()
	}
}

func TestServerFilesystemMethodsOverWailsTransport(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "archive.zip"), nil, 0o600); err != nil {
		t.Fatal(err)
	}

	port := freeTCPPort(t)
	cmd := exec.Command(os.Args[0], "-test.run=^TestServerStartupProcess$")
	cmd.Env = append(os.Environ(), "MODKEEPER_TEST_SERVER_PROCESS=1", "MODKEEPER_SERVER_HOST=127.0.0.1", "MODKEEPER_SERVER_PORT="+strconv.Itoa(port), "XDG_CONFIG_HOME="+t.TempDir(), "XDG_DATA_HOME="+t.TempDir())
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := cmd.Process.Kill(); err != nil && err != os.ErrProcessDone {
			t.Errorf("stop server: %v", err)
		}
		_ = cmd.Wait()
		if t.Failed() {
			t.Logf("server output: %s", output.String())
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
