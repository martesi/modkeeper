package forge

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/martes/modkeeper/backend/models"
)

func testService(t *testing.T, handler http.HandlerFunc) *Service {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	s := NewService(NewClient(), func() (string, error) { return "4.0.11", nil })
	s.BaseURL = server.URL
	return s
}
func assertCode(t *testing.T, err error, code string) {
	t.Helper()
	var e *Error
	if !errors.As(err, &e) || e.Code != code {
		t.Fatalf("expected %s, got %v", code, err)
	}
}
func TestApiRecordRequiresIdentityFields(t *testing.T) {
	r, err := record(json.RawMessage(`{"data":{"id":1,"name":"Example"}}`))
	if err != nil {
		t.Fatal(err)
	}
	_, err = r.convert("mod", false, false)
	assertCode(t, err, "ParseError")
}
func TestAddonSearchOmitsUnsupportedSptFilter(t *testing.T) {
	s := testService(t, func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("page") != "1" || q.Get("per_page") != "50" || q.Get("query") != "query" {
			t.Errorf("params: %v", q)
		}
		if r.URL.Path == "/mods" {
			if q.Get("filter[spt_version]") != "4.0.11" {
				t.Error("missing SPT")
			}
		} else {
			if q.Has("filter[spt_version]") || q.Get("include") != "mod" {
				t.Error("addon params")
			}
		}
		fmt.Fprint(w, `{"data":[{"id":1,"guid":"g","name":"n"}],"meta":{"current_page":1}}`)
	})
	body, err := s.Search("  query  ", 0, 0, 100)
	if err != nil || !strings.Contains(string(body), `"sptVersion":"4.0.11"`) {
		t.Fatalf("%s %v", body, err)
	}
}
func TestSupportedDownloadExtensionsAreExplicit(t *testing.T) {
	for name, want := range map[string]string{"mod.zip": "zip", "mod.7z": "7z", "mod.rar": "", "MOD.ZIP": "zip"} {
		if got := supportedArchiveExtension(name); got != want {
			t.Fatalf("%s: %s", name, got)
		}
	}
}
func TestContentLengthMismatchEmitsVerificationStageBeforeFailing(t *testing.T) {
	var stages []models.TaskProgressStage
	err := verifyDownloadSize(9, 9, 10, func(s models.TaskProgressStage, p *float64) {
		stages = append(stages, s)
		if p != nil {
			t.Error("percent must be null")
		}
	})
	assertCode(t, err, "ParseError")
	if len(stages) != 1 || stages[0] != models.TaskStageForgeSizeVerification {
		t.Fatal(stages)
	}
}
func TestApiVersionRequiresDownloadSizeAndLink(t *testing.T) {
	var v apiVersion
	if err := json.Unmarshal([]byte(`{"id":5,"version":"1.2.0","link":"https://sp-mod.com/download"}`), &v); err != nil {
		t.Fatal(err)
	}
	_, err := v.convert("mod", 1)
	assertCode(t, err, "ParseError")
}
func TestRetryAfterAcceptsSecondsAndHttpDate(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	if retryAfter("30", now) != 30*time.Second || retryAfter(now.Add(time.Minute).Format(http.TimeFormat), now) != time.Minute {
		t.Fatal("retry parser")
	}
}
func TestCommandsMapMalformedJSONAndHTTPFailures(t *testing.T) {
	for _, command := range []string{"Search", "Detail", "Versions", "AddonVersions", "DownloadVersion"} {
		for _, bad := range []string{"json", "http", "shape"} {
			t.Run(command+"/"+bad, func(t *testing.T) {
				s := testService(t, func(w http.ResponseWriter, r *http.Request) {
					switch bad {
					case "http":
						w.WriteHeader(503)
					case "json":
						fmt.Fprint(w, "{")
					default:
						fmt.Fprint(w, `{"data":{}}`)
					}
				})
				var err error
				switch command {
				case "Search":
					_, err = s.Search("", 1, 1, 20)
				case "Detail":
					_, err = s.Detail("mod", 1)
				case "Versions":
					_, err = s.Versions("mod", 1, 1)
				case "AddonVersions":
					_, err = s.Versions("addon", 1, 1)
				case "DownloadVersion":
					done := make(chan error, 1)
					s.Hooks = InstallHooks{Admit: func(ForgeDownloadVersionInput) (string, string, error) { return "4.0.11", t.TempDir(), nil }, Install: func(ForgeDownloadVersionInput, string, InstallMetadata, *AddonConstraint, Progress) error { return nil }, Complete: func(_ ForgeDownloadVersionInput, e error) { done <- e }, Release: func(string) {}}
					_, err = s.DownloadVersion(ForgeDownloadVersionInput{Kind: "mod", ItemID: 1, VersionID: 2})
					if err == nil {
						select {
						case err = <-done:
						case <-time.After(3 * time.Second):
							t.Fatal("completion timeout")
						}
					}
				}
				want := "ParseError"
				if bad == "http" {
					want = "IOError"
				}
				assertCode(t, err, want)
			})
		}
	}
}
func TestCommandsRequireActiveLibrary(t *testing.T) {
	s := NewService(nil, nil)
	for _, call := range []func() (json.RawMessage, error){func() (json.RawMessage, error) { return s.Search("", 1, 1, 1) }, func() (json.RawMessage, error) { return s.Detail("mod", 1) }, func() (json.RawMessage, error) { return s.Versions("mod", 1, 1) }, func() (json.RawMessage, error) { return s.Versions("addon", 1, 1) }} {
		_, err := call()
		assertCode(t, err, "NoActiveLibrary")
	}
	_, err := s.DownloadVersion(ForgeDownloadVersionInput{Kind: "mod"})
	assertCode(t, err, "NoActiveLibrary")
}
func TestVersionsPaginationParams(t *testing.T) {
	s := testService(t, func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("page") != "1" || q.Get("per_page") != "50" || q.Get("include") != "dependencies" || q.Get("filter[spt_version]") != "4.0.11" {
			t.Error(q)
		}
		fmt.Fprint(w, `{"data":[{"id":2,"version":"1","link":"https://example.test/a.zip","content_length":3}]}`)
	})
	for _, kind := range []string{"mod", "addon"} {
		body, err := s.Versions(kind, 1, 1)
		if err != nil || !strings.Contains(string(body), `"contentLength":3`) {
			t.Fatalf("%s %v", body, err)
		}
	}
}
func TestDownloadWritesBytesAndReportsProgressWithoutTouchingSourceArchive(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source.zip")
	if err := os.WriteFile(source, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	var base string
	s := testService(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/mod/1":
			fmt.Fprint(w, `{"data":{"id":1,"guid":"g","name":"n"}}`)
		case "/mod/1/versions":
			fmt.Fprintf(w, `{"data":[{"id":2,"version":"1.0.0","link":%q,"content_length":3}]}`, base+"/archive.zip")
		case "/archive.zip":
			fmt.Fprint(w, "zip")
		default:
			t.Error(r.URL.Path)
		}
	})
	base = s.BaseURL
	done := make(chan error, 1)
	released := make(chan struct{})
	var archive string
	var stages []models.TaskProgressStage
	s.Hooks = InstallHooks{
		Admit: func(ForgeDownloadVersionInput) (string, string, error) { return "4.0.11", root, nil },
		Install: func(_ ForgeDownloadVersionInput, path string, m InstallMetadata, c *AddonConstraint, p Progress) error {
			archive = path
			bytes, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if string(bytes) != "zip" || m.ForgeGUID != "g" || c != nil {
				return fmt.Errorf("bad install %s %+v", bytes, m)
			}
			return nil
		},
		SendProgress: func(e models.TaskProgressEvent) error { stages = append(stages, e.Stage); return nil }, Complete: func(_ ForgeDownloadVersionInput, err error) { done <- err }, Release: func(string) { close(released) },
	}
	accepted, err := s.DownloadVersion(ForgeDownloadVersionInput{TaskID: "t", LibraryID: "l", Kind: "mod", ItemID: 1, VersionID: 2})
	if err != nil || string(accepted) != `{"accepted":true}` {
		t.Fatalf("%s %v", accepted, err)
	}
	select {
	case err = <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timeout")
	}
	<-released
	if _, err = os.Stat(archive); !os.IsNotExist(err) {
		t.Fatalf("download left behind: %v", err)
	}
	bytes, err := os.ReadFile(source)
	if err != nil || string(bytes) != "original" {
		t.Fatal("source changed")
	}
	found := false
	for _, stage := range stages {
		if stage == models.TaskStageForgeSizeVerification {
			found = true
		}
	}
	if !found {
		t.Fatal(stages)
	}
}
func TestFreshCacheTTLAndRedirectTargetsAreNotPinned(t *testing.T) {
	requests := 0
	target := "/one"
	s := testService(t, func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.URL.Path == "/api" {
			http.Redirect(w, r, target, 302)
			return
		}
		fmt.Fprintf(w, `{"target":%q}`, r.URL.Path)
	})
	u := s.BaseURL + "/api"
	_, _, err := s.Client.CachedJSON(u)
	if err != nil {
		t.Fatal(err)
	}
	_, stale, err := s.Client.CachedJSON(u)
	if err != nil || stale || requests != 2 {
		t.Fatal(requests, stale, err)
	}
	entry := s.Client.cache[u]
	entry.StoredAt = time.Now().Add(-cacheTTL)
	s.Client.cache[u] = entry
	target = "/two"
	body, stale, err := s.Client.CachedJSON(u)
	if err != nil || stale || !strings.Contains(string(body), "two") {
		t.Fatalf("%s %v", body, err)
	}
	if _, ok := s.Client.cache[s.BaseURL+"/one"]; ok {
		t.Fatal("redirect target cached")
	}
}
