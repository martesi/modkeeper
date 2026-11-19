package forge

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRejectsUnsafeRedirectSchemesAndLimitsHops(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "file:///etc/passwd", 302) }))
	defer server.Close()
	c := NewClient()
	if _, err := c.Get(server.URL); err == nil {
		t.Fatal("unsafe redirect accepted")
	}
}

func TestCachedJSONServesStaleOnFailureOnly(t *testing.T) {
	var fail bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail {
			http.Error(w, "offline", 500)
			return
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	c := NewClient()
	body, stale, err := c.CachedJSON(srv.URL)
	if err != nil || stale || !strings.Contains(string(body), `"ok"`) {
		t.Fatalf("initial: %s %v %v", body, stale, err)
	}
	c.mu.Lock()
	entry := c.cache[srv.URL]
	entry.StoredAt = time.Now().Add(-48 * time.Hour)
	c.cache[srv.URL] = entry
	c.mu.Unlock()
	fail = true
	body, stale, err = c.CachedJSON(srv.URL)
	if err != nil || !stale || !strings.Contains(string(body), `"ok"`) {
		t.Fatalf("stale fallback: %s %v %v", body, stale, err)
	}
}

func TestRateLimitRetryAfterBlocksRequests(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Header().Set("Retry-After", "60"); w.WriteHeader(429) }))
	defer srv.Close()
	c := NewClient()
	if _, err := c.Get(srv.URL); err == nil {
		t.Fatal("429 should fail")
	}
	if _, err := c.Get(srv.URL); err == nil || !strings.Contains(err.Error(), "retry") {
		t.Fatalf("expected blocked retry, got %v", err)
	}
}
