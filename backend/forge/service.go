package forge

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// Service requires a live-library resolver; an empty SPT version is valid if
// the resolver returns it. No library is represented by NoActiveLibrary.
type Service struct {
	Client        *Client
	BaseURL       string
	ActiveVersion func() (string, error)
	Hooks         InstallHooks
}

func NewService(client *Client, activeVersion func() (string, error)) *Service {
	if client == nil {
		client = NewClient()
	}
	return &Service{Client: client, BaseURL: APIBase, ActiveVersion: activeVersion}
}
func (s *Service) active() (string, error) {
	if s.ActiveVersion == nil {
		return "", &Error{Code: "NoActiveLibrary"}
	}
	return s.ActiveVersion()
}
func (s *Service) get(path string, params map[string]string) (json.RawMessage, bool, error) {
	u, err := url.Parse(strings.TrimRight(s.BaseURL, "/") + "/" + path)
	if err != nil {
		return nil, false, fail("ParseError", "Invalid Forge API URL: "+err.Error())
	}
	q := u.Query()
	for k, v := range params {
		q.Set(k, v)
	}
	u.RawQuery = q.Encode()
	return s.Client.CachedJSON(u.String())
}
func searchParams(kind, query string, page, perPage int, version string) map[string]string {
	p := map[string]string{"page": fmt.Sprint(max(1, page)), "per_page": fmt.Sprint(min(50, max(1, perPage)))}
	if kind == "mod" {
		p["filter[spt_version]"] = version
	} else {
		p["include"] = "mod"
	}
	if query = strings.TrimSpace(query); query != "" {
		p["query"] = query
	}
	return p
}
func (s *Service) Search(query string, modPage, addonPage, perPage int) (json.RawMessage, bool, error) {
	version, err := s.active()
	if err != nil {
		return nil, false, err
	}
	result := object{"sptVersion": version}
	stale := false
	for _, item := range []struct {
		kind string
		page int
	}{{"mod", modPage}, {"addon", addonPage}} {
		body, old, err := s.get(item.kind+"s", searchParams(item.kind, query, item.page, perPage, version))
		if err != nil {
			return nil, false, err
		}
		records, meta, err := page[apiRecord](body)
		if err != nil {
			return nil, false, err
		}
		items := []object{}
		for _, r := range records {
			o, err := r.convert(item.kind, false, old)
			if err != nil {
				return nil, false, err
			}
			items = append(items, o)
		}
		result[item.kind+"s"] = object{"items": items, "pagination": meta, "stale": old}
		stale = stale || old
	}
	body, err := json.Marshal(result)
	return body, stale, err
}
func (s *Service) detail(kind string, id uint64) (object, bool, error) {
	params := map[string]string{}
	if kind == "addon" {
		params["include"] = "mod"
	}
	body, stale, err := s.get(fmt.Sprintf("%s/%d", kind, id), params)
	if err != nil {
		return nil, false, err
	}
	r, err := record(body)
	if err != nil {
		return nil, false, err
	}
	o, err := r.convert(kind, true, stale)
	if err != nil {
		return nil, false, err
	}
	p := r.parent()
	if kind == "addon" && (r.Detached == nil || !*r.Detached) && p != nil && (p["guid"] == "" || p["name"] == "") {
		parent, old, err := s.detail("mod", p["id"].(uint64))
		if err != nil {
			return nil, false, err
		}
		o["parent"] = object{"id": p["id"], "guid": parent["guid"], "name": parent["name"], "detailUrl": parent["detailUrl"]}
		stale = stale || old
		o["stale"] = stale
	}
	return o, stale, nil
}
func (s *Service) ModDetail(id uint32) (json.RawMessage, bool, error) {
	if _, err := s.active(); err != nil {
		return nil, false, err
	}
	o, stale, err := s.detail("mod", uint64(id))
	if err != nil {
		return nil, false, err
	}
	body, err := json.Marshal(o)
	return body, stale, err
}
func (s *Service) versions(kind string, id uint64, p int, version string) (object, bool, error) {
	body, stale, err := s.get(fmt.Sprintf("%s/%d/versions", kind, id), map[string]string{"page": fmt.Sprint(max(1, p)), "per_page": "50", "filter[spt_version]": version, "include": "dependencies"})
	if err != nil {
		return nil, false, err
	}
	records, meta, err := page[apiVersion](body)
	if err != nil {
		return nil, false, err
	}
	items := []object{}
	for _, r := range records {
		o, err := r.convert(kind, id)
		if err != nil {
			return nil, false, err
		}
		items = append(items, o)
	}
	return object{"kind": kind, "itemId": id, "versions": items, "pagination": meta, "stale": stale}, stale, nil
}
func (s *Service) versionsCommand(kind string, id uint32) (json.RawMessage, bool, error) {
	version, err := s.active()
	if err != nil {
		return nil, false, err
	}
	o, stale, err := s.versions(kind, uint64(id), 1, version)
	if err != nil {
		return nil, false, err
	}
	body, err := json.Marshal(o)
	return body, stale, err
}
func (s *Service) ModVersions(id uint32) (json.RawMessage, bool, error) {
	return s.versionsCommand("mod", id)
}
func (s *Service) AddonVersions(id uint32) (json.RawMessage, bool, error) {
	return s.versionsCommand("addon", id)
}
func (s *Service) findVersion(kind string, id, versionID uint64, spt string) (object, bool, error) {
	last := 1
	for p := 1; p <= last; p++ {
		o, stale, err := s.versions(kind, id, p, spt)
		if err != nil {
			return nil, false, err
		}
		for _, v := range o["versions"].([]object) {
			if v["id"] == versionID {
				return v, stale, nil
			}
		}
		if p == 1 {
			if n := o["pagination"].(object)["lastPage"].(*uint64); n != nil {
				last = int(min(*n, 100))
			}
		}
	}
	return nil, false, fail("ParseError", fmt.Sprintf("Forge version %d was not found among versions compatible with SPT %s", versionID, spt))
}
