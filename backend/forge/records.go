package forge

import (
	"encoding/json"
	"fmt"
)

type object = map[string]any

type apiParent struct {
	ID        *uint64 `json:"id"`
	GUID      *string `json:"guid"`
	Name      *string `json:"name"`
	DetailURL *string `json:"detail_url"`
}
type apiRecord struct {
	apiParent
	Slug        *string    `json:"slug"`
	Teaser      *string    `json:"teaser"`
	Description *string    `json:"description"`
	Thumbnail   *string    `json:"thumbnail"`
	Fika        *bool      `json:"fika_compatibility"`
	ModID       *uint64    `json:"mod_id"`
	Detached    *bool      `json:"is_detached"`
	Constraint  *string    `json:"mod_version_constraint"`
	Mod         *apiParent `json:"mod"`
	Parent      *apiParent `json:"parent"`
}

func (r apiRecord) parent() object {
	p := r.Mod
	if p == nil {
		p = r.Parent
	}
	id := r.ModID
	if id == nil && p != nil {
		id = p.ID
	}
	if id == nil {
		return nil
	}
	guid, name := "", ""
	var detail *string
	if p != nil {
		if p.GUID != nil {
			guid = *p.GUID
		}
		if p.Name != nil {
			name = *p.Name
		}
		detail = p.DetailURL
	}
	return object{"id": *id, "guid": guid, "name": name, "detailUrl": detail}
}
func (r apiRecord) convert(kind string, detail, stale bool) (object, error) {
	if r.ID == nil {
		return nil, fail("ParseError", "Forge record is missing required id")
	}
	if r.GUID == nil || *r.GUID == "" {
		return nil, fail("ParseError", "Forge record is missing required guid")
	}
	if r.Name == nil || *r.Name == "" {
		return nil, fail("ParseError", "Forge record is missing required name")
	}
	o := object{"kind": kind, "id": *r.ID, "guid": *r.GUID, "name": *r.Name, "slug": r.Slug, "teaser": r.Teaser, "thumbnail": r.Thumbnail, "detailUrl": r.DetailURL, "fikaCompatibility": r.Fika, "parentModId": nil, "modVersionConstraint": r.Constraint, "isDetached": r.Detached}
	p := r.parent()
	if p != nil {
		o["parentModId"] = p["id"]
	}
	if detail {
		o["description"] = r.Description
		o["parent"] = p
		o["stale"] = stale
	} else {
		for _, key := range []string{"parentModGuid", "parentModName", "parentModDetailUrl"} {
			o[key] = nil
		}
		if p != nil {
			if p["guid"] != "" {
				o["parentModGuid"] = p["guid"]
			}
			if p["name"] != "" {
				o["parentModName"] = p["name"]
			}
			o["parentModDetailUrl"] = p["detailUrl"]
		}
	}
	return o, nil
}

type apiDependency struct {
	ModID      *uint64 `json:"mod_id"`
	GUID       *string `json:"mod_guid"`
	Name       *string `json:"mod_name"`
	Constraint *string `json:"version_constraint"`
	Optional   *bool   `json:"is_optional"`
}
type apiVersion struct {
	ID           *uint64         `json:"id"`
	Version      *string         `json:"version"`
	Description  *string         `json:"description"`
	Link         *string         `json:"link"`
	Size         *uint64         `json:"content_length"`
	SPT          *string         `json:"spt_version_constraint"`
	Fika         *string         `json:"fika_compatibility"`
	Dependencies []apiDependency `json:"dependencies"`
}

func (v apiVersion) convert(kind string, id uint64) (object, error) {
	if v.ID == nil || v.Version == nil || v.Link == nil || v.Size == nil {
		return nil, fail("ParseError", "Malformed Forge page data: missing version id, version, link or content_length")
	}
	d := []object{}
	for _, dep := range v.Dependencies {
		d = append(d, object{"modId": dep.ModID, "modGuid": dep.GUID, "modName": dep.Name, "versionConstraint": dep.Constraint, "isOptional": dep.Optional})
	}
	return object{"kind": kind, "itemId": id, "id": *v.ID, "version": *v.Version, "description": v.Description, "link": *v.Link, "contentLength": *v.Size, "sptVersionConstraint": v.SPT, "fikaCompatibility": v.Fika, "dependencies": d}, nil
}

type pageMeta struct {
	Current *uint64 `json:"current_page"`
	Last    *uint64 `json:"last_page"`
	PerPage *uint64 `json:"per_page"`
	Total   *uint64 `json:"total"`
}

func page[T any](body json.RawMessage) ([]T, object, error) {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, nil, fail("ParseError", err.Error())
	}
	data, ok := envelope["data"]
	if !ok {
		return nil, nil, fail("ParseError", "Forge response is missing data")
	}
	if len(data) == 0 || data[0] != '[' {
		return nil, nil, fail("ParseError", "Forge page data is not an array")
	}
	var values []T
	if err := json.Unmarshal(data, &values); err != nil {
		return nil, nil, fail("ParseError", "Malformed Forge page data: "+err.Error())
	}
	var meta pageMeta
	if raw, ok := envelope["meta"]; ok {
		if string(raw) == "null" {
			return nil, nil, fail("ParseError", "Malformed Forge pagination: null")
		}
		if err := json.Unmarshal(raw, &meta); err != nil {
			return nil, nil, fail("ParseError", "Malformed Forge pagination: "+err.Error())
		}
	}
	return values, object{"currentPage": meta.Current, "lastPage": meta.Last, "perPage": meta.PerPage, "total": meta.Total}, nil
}
func record(body json.RawMessage) (apiRecord, error) {
	var envelope map[string]json.RawMessage
	var r apiRecord
	if err := json.Unmarshal(body, &envelope); err != nil {
		return r, fail("ParseError", err.Error())
	}
	raw, ok := envelope["data"]
	if !ok {
		return r, fail("ParseError", "Forge response is missing data")
	}
	if string(raw) == "null" {
		return r, fail("ParseError", "Malformed Forge detail: null")
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return r, fail("ParseError", fmt.Sprintf("Malformed Forge detail: %v", err))
	}
	return r, nil
}
