// Package forge provides the SP-Tarkov mod forge API client with bounded
// redirects, a disk-independent response cache, and conservative stale fallback.
package forge

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const APIBase = "https://sp-mod.com/api/v0"
const cacheTTL = 24 * time.Hour

type CachedResponse struct {
	StoredAt time.Time       `json:"storedAt"`
	Body     json.RawMessage `json:"body"`
}
type Client struct {
	HTTP         *http.Client
	mu           sync.Mutex
	cache        map[string]CachedResponse
	requests     []time.Time
	blockedUntil time.Time
}

func NewClient() *Client {
	return &Client{HTTP: &http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 || (req.URL.Scheme != "http" && req.URL.Scheme != "https") {
			return http.ErrUseLastResponse
		}
		return nil
	}}, cache: map[string]CachedResponse{}}
}

func (c *Client) CachedJSON(rawURL string) (json.RawMessage, bool, error) {
	c.mu.Lock()
	cached, found := c.cache[rawURL]
	c.mu.Unlock()
	if found && time.Since(cached.StoredAt) < cacheTTL {
		return cached.Body, false, nil
	}
	body, err := c.Get(rawURL)
	if err != nil {
		if found {
			return cached.Body, true, nil
		}
		return nil, false, err
	}
	c.mu.Lock()
	c.cache[rawURL] = CachedResponse{time.Now(), body}
	c.mu.Unlock()
	return body, false, nil
}

func (c *Client) Get(rawURL string) (json.RawMessage, error) {
	if err := c.acquire(); err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Modkeeper")
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Forge request failed: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusTooManyRequests {
		delay := 30 * time.Second
		if n, e := strconv.Atoi(res.Header.Get("Retry-After")); e == nil && n >= 0 {
			delay = time.Duration(n) * time.Second
		}
		c.mu.Lock()
		c.blockedUntil = time.Now().Add(delay)
		c.mu.Unlock()
		return nil, fmt.Errorf("Forge rate limit reached; retry after %d seconds", max(1, int(delay.Seconds())))
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, fmt.Errorf("Forge returned HTTP %d", res.StatusCode)
	}
	b, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	if !json.Valid(b) {
		return nil, fmt.Errorf("Forge returned invalid JSON")
	}
	return b, nil
}

func (c *Client) acquire() error {
	now := time.Now()
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.blockedUntil.After(now) {
		return fmt.Errorf("Forge asked this client to retry in %d seconds", max(1, int(time.Until(c.blockedUntil).Seconds())))
	}
	cutoff := now.Add(-time.Minute)
	kept := c.requests[:0]
	for _, t := range c.requests {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	c.requests = kept
	if len(kept) >= 200 {
		return fmt.Errorf("Forge request quota reached")
	}
	c.requests = append(c.requests, now)
	return nil
}

func URL(path string, query map[string]string) (string, error) {
	u, err := url.Parse(APIBase + "/" + strings.TrimLeft(path, "/"))
	if err != nil {
		return "", err
	}
	q := u.Query()
	for k, v := range query {
		q.Set(k, v)
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func (c *Client) Search(query string, modPage, addonPage, perPage int) (json.RawMessage, bool, error) {
	u, err := URL("search", map[string]string{"query": query, "modPage": strconv.Itoa(modPage), "addonPage": strconv.Itoa(addonPage), "perPage": strconv.Itoa(perPage)})
	if err != nil {
		return nil, false, err
	}
	return c.CachedJSON(u)
}
