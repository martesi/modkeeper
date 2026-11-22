package forge

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/martes/modkeeper/backend/models"
)

func TestAddonDetailResolvesIncompleteParent(t *testing.T) {
	s := testService(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/addon/2" {
			if r.URL.Query().Get("include") != "mod" {
				t.Error("missing include")
			}
			fmt.Fprint(w, `{"data":{"id":2,"guid":"a","name":"addon","mod_id":1}}`)
			return
		}
		fmt.Fprint(w, `{"data":{"id":1,"guid":"p","name":"parent"}}`)
	})
	o, stale, err := s.detail("addon", 2)
	if err != nil || stale {
		t.Fatal(err)
	}
	if o["parent"].(object)["guid"] != "p" {
		t.Fatal(o)
	}
}
func TestModDetailWireUsesCamelCaseAndExplicitNulls(t *testing.T) {
	s := testService(t, func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"data":{"id":1,"guid":"g","name":"n","detail_url":"url","fika_compatibility":true}}`)
	})
	body, err := s.Detail("mod", 1)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"detailUrl":"url"`, `"fikaCompatibility":true`, `"parent":null`, `"description":null`, `"stale":false`} {
		if !strings.Contains(string(body), field) {
			t.Fatalf("missing %s: %s", field, body)
		}
	}
}
func TestFindVersionReadsLaterPagesAndCapsAt100(t *testing.T) {
	count := 0
	s := testService(t, func(w http.ResponseWriter, r *http.Request) {
		count++
		if r.URL.Query().Get("page") == "2" {
			fmt.Fprint(w, `{"data":[{"id":9,"version":"1","link":"url","content_length":0}]}`)
		} else {
			fmt.Fprint(w, `{"data":[],"meta":{"last_page":200}}`)
		}
	})
	v, stale, err := s.findVersion("mod", 1, 9, "4")
	if err != nil || stale || v["id"] != uint64(9) || count != 2 {
		t.Fatal(v, stale, err, count)
	}
	// Cached pages keep the test below the network quota while verifying the cap.
	for p := 3; p <= 100; p++ {
		u := fmt.Sprintf("%s/mod/1/versions?filter%%5Bspt_version%%5D=4&include=dependencies&page=%d&per_page=50", s.BaseURL, p)
		s.Client.cache[u] = CachedResponse{time.Now(), json.RawMessage(`{"data":[]}`)}
	}
	_, _, err = s.findVersion("mod", 1, 10, "4")
	assertCode(t, err, "ParseError")
	if count != 2 {
		t.Fatal("pagination cap failed", count)
	}
}
func TestDownloadSizeMismatchRemovesGeneratedArchive(t *testing.T) {
	s := testService(t, func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "abc") })
	root := t.TempDir()
	v := object{"itemId": uint64(1), "id": uint64(2), "link": s.BaseURL + "/a.zip", "contentLength": uint64(4)}
	_, err := s.downloadArchive(v, root, func(models.TaskProgressStage, *float64) {})
	assertCode(t, err, "ParseError")
	files, err := os.ReadDir(root)
	if err != nil || len(files) != 0 {
		t.Fatal(files, err)
	}
}
func TestMatchInstalledModPassesSelectedIdentityAndAddonConstraint(t *testing.T) {
	s := testService(t, func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "versions") {
			fmt.Fprint(w, `{"data":[{"id":2,"version":"1.2.0","link":"url","content_length":0}]}`)
		} else {
			fmt.Fprint(w, `{"data":{"id":1,"guid":"a","name":"addon","mod_version_constraint":"^1.0","mod":{"id":3,"guid":"p","name":"parent"}}}`)
		}
	})
	s.Hooks.AssertLibrary = func(id string) error {
		if id != "l" {
			t.Fatal(id)
		}
		return nil
	}
	s.Hooks.Match = func(input ForgeMatchInstalledModInput, m InstallMetadata, c *AddonConstraint) (json.RawMessage, error) {
		if input.InstalledModID != "local" || m.ForgeGUID != "a" || m.Version != "1.2.0" || c == nil || *c.ParentForgeID != 3 || *c.ParentGUID != "p" || *c.VersionConstraint != "^1.0" {
			t.Fatal(input, m, c)
		}
		return json.RawMessage(`{"workspace":true}`), nil
	}
	_, err := s.MatchInstalledMod(ForgeMatchInstalledModInput{LibraryID: "l", InstalledModID: "local", Kind: "addon", ItemID: 1, VersionID: 2})
	if err != nil {
		t.Fatal(err)
	}
}
func TestStaleMetadataCannotInstallOrMatch(t *testing.T) {
	s := testService(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) })
	u := s.BaseURL + "/mod/1"
	s.Client.cache[u] = CachedResponse{time.Now().Add(-48 * time.Hour), json.RawMessage(`{"data":{"id":1,"guid":"g","name":"n"}}`)}
	for _, action := range []string{"installing", "matching"} {
		_, _, err := s.metadata("mod", 1, 2, "4", action, func(models.TaskProgressStage, *float64) {})
		assertCode(t, err, "IOError")
	}
}
func TestRateQuotaWaitsForTenSecondAndMinuteWindows(t *testing.T) {
	for _, n := range []int{40, 200} {
		t.Run(fmt.Sprint(n), func(t *testing.T) {
			c := NewClient()
			window := 10 * time.Second
			if n == 200 {
				window = time.Minute
			}
			stamp := time.Now().Add(-window + 20*time.Millisecond)
			for i := 0; i < n; i++ {
				c.requests = append(c.requests, stamp)
			}
			start := time.Now()
			if err := c.acquire(); err != nil {
				t.Fatal(err)
			}
			if time.Since(start) < 10*time.Millisecond {
				t.Fatal("quota did not wait")
			}
		})
	}
}
func TestRedirectHopBound(t *testing.T) {
	count := 0
	s := testService(t, func(w http.ResponseWriter, r *http.Request) { count++; http.Redirect(w, r, "/again", 302) })
	_, err := s.Client.Get(s.BaseURL)
	assertCode(t, err, "IOError")
	if count != 10 {
		t.Fatal(count)
	}
}

func TestRedirectDoesNotDowngradeHTTPS(t *testing.T) {
	c := NewClient()
	from, _ := http.NewRequest(http.MethodGet, "https://example.test/start", nil)
	to, _ := http.NewRequest(http.MethodGet, "http://example.test/end", nil)
	if err := c.HTTP.CheckRedirect(to, []*http.Request{from}); err != http.ErrUseLastResponse {
		t.Fatalf("expected HTTPS downgrade to be refused, got %v", err)
	}
}

func TestSingleResponseObjectsEmbedStale(t *testing.T) {
	s := testService(t, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) })
	expired := time.Now().Add(-2 * cacheTTL)
	prime := func(path string, params map[string]string, body string) {
		t.Helper()
		u, err := url.Parse(s.BaseURL + "/" + path)
		if err != nil {
			t.Fatal(err)
		}
		q := u.Query()
		for key, value := range params {
			q.Set(key, value)
		}
		u.RawQuery = q.Encode()
		s.Client.cache[u.String()] = CachedResponse{StoredAt: expired, Body: json.RawMessage(body)}
	}
	prime("mods", map[string]string{"filter[spt_version]": "4.0.11", "page": "1", "per_page": "20"}, `{"data":[{"id":1,"guid":"g","name":"n"}]}`)
	prime("addons", map[string]string{"include": "mod", "page": "1", "per_page": "20"}, `{"data":[{"id":2,"guid":"a","name":"a"}]}`)
	prime("mod/1", nil, `{"data":{"id":1,"guid":"g","name":"n"}}`)
	prime("addon/2", map[string]string{"include": "mod"}, `{"data":{"id":2,"guid":"a","name":"a","mod_id":1}}`)
	prime("mod/1/versions", map[string]string{"filter[spt_version]": "4.0.11", "include": "dependencies", "page": "2", "per_page": "50"}, `{"data":[{"id":9,"version":"1","link":"url","content_length":0}]}`)
	prime("addon/2/versions", map[string]string{"filter[spt_version]": "4.0.11", "include": "dependencies", "page": "3", "per_page": "50"}, `{"data":[{"id":8,"version":"1","link":"url","content_length":0}]}`)

	calls := map[string]func() (json.RawMessage, error){
		"search":         func() (json.RawMessage, error) { return s.Search("", 1, 1, 20) },
		"mod detail":     func() (json.RawMessage, error) { return s.Detail("mod", 1) },
		"addon detail":   func() (json.RawMessage, error) { return s.Detail("addon", 2) },
		"mod versions":   func() (json.RawMessage, error) { return s.Versions("mod", 1, 2) },
		"addon versions": func() (json.RawMessage, error) { return s.Versions("addon", 2, 3) },
	}
	for name, call := range calls {
		t.Run(name, func(t *testing.T) {
			body, err := call()
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(body), `"stale":true`) {
				t.Fatalf("stale flag missing: %s", body)
			}
		})
	}
}
