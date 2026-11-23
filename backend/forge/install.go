package forge

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/martes/modkeeper/backend/models"
	"github.com/martes/modkeeper/backend/task_progress"
)

// Forge command inputs are aliases of the shared durable models so Wails
// bindings expose the ForgeKind enum used by the frontend.
type ForgeDownloadVersionInput = models.ForgeDownloadVersionInput
type ForgeMatchInstalledModInput = models.ForgeMatchInstalledModInput
type InstallMetadata struct {
	Kind      string
	ForgeID   uint64
	ForgeGUID string
	Version   string
	VersionID uint64
	CachedAt  string
}
type AddonConstraint struct {
	IsDetached        bool
	ParentForgeID     *uint64
	ParentGUID        *string
	VersionConstraint *string
}
type Progress func(models.TaskProgressStage, *float64)

// Admit must assert the active library, obtain the stage root and then reserve
// the task ID, in that order. Install must use standard archive staging, require
// exactly one entry, recheck the library, validate the addon parent against
// installed Forge metadata, and clean staged entries (library_service.rs).
// Complete emits mod_install_completed with the current workspace; Release
// removes the task ID only after that event. Missing hooks fail closed.
type InstallHooks struct {
	Admit         func(ForgeDownloadVersionInput) (sptVersion, stageRoot string, err error)
	Install       func(ForgeDownloadVersionInput, string, InstallMetadata, *AddonConstraint, Progress) error
	Match         func(ForgeMatchInstalledModInput, InstallMetadata, *AddonConstraint) (*models.LibraryWorkspace, error)
	AssertLibrary func(string) error
	SendProgress  func(models.TaskProgressEvent) error
	Complete      func(ForgeDownloadVersionInput, error)
	Release       func(string)
}

func validKind(kind string) error {
	if kind != "mod" && kind != "addon" {
		return fail("ParseError", "Invalid Forge kind")
	}
	return nil
}
func (s *Service) DownloadVersion(input ForgeDownloadVersionInput) (json.RawMessage, error) {
	if err := validKind(string(input.Kind)); err != nil {
		return nil, err
	}
	if s.Hooks.Admit == nil {
		return nil, &Error{Code: "NoActiveLibrary"}
	}
	if s.Hooks.Install == nil || s.Hooks.Complete == nil || s.Hooks.Release == nil {
		return nil, fail("Unexpected", "Forge library hooks are not initialized")
	}
	spt, root, err := s.Hooks.Admit(input)
	if err != nil {
		return nil, err
	}
	progress := task_progress.New(input.TaskID, input.LibraryID, models.TaskOperationForgeInstall, s.Hooks.SendProgress)
	_ = progress.StartAfterAdmission(nil)
	go func() {
		err := s.downloadAndInstall(input, spt, root, progress.Progress)
		outcome := task_progress.Success
		if err != nil {
			outcome = task_progress.Failure
		}
		progress.Completed(outcome)
		s.Hooks.Complete(input, err)
		s.Hooks.Release(input.TaskID)
	}()
	return json.RawMessage(`{"accepted":true}`), nil
}
func (s *Service) metadata(kind string, id, versionID uint64, spt, action string, progress Progress) (object, object, error) {
	progress(models.TaskStageForgeMetadata, nil)
	r, stale, err := s.detail(kind, id)
	if err != nil {
		return nil, nil, err
	}
	if stale {
		return nil, nil, fail("IOError", "Forge detail is stale; reconnect before "+action+" this item")
	}
	progress(models.TaskStageForgeVersions, nil)
	v, stale, err := s.findVersion(kind, id, versionID, spt)
	if err != nil {
		return nil, nil, err
	}
	if stale {
		return nil, nil, fail("IOError", "Forge version data is stale; reconnect before "+action+" this version")
	}
	return r, v, nil
}
func installMetadata(kind string, id uint64, r, v object) (InstallMetadata, *AddonConstraint) {
	m := InstallMetadata{Kind: kind, ForgeID: id, ForgeGUID: r["guid"].(string), Version: v["version"].(string), VersionID: v["id"].(uint64), CachedAt: time.Now().UTC().Format(time.RFC3339)}
	var c *AddonConstraint
	if kind == "addon" {
		c = &AddonConstraint{VersionConstraint: r["modVersionConstraint"].(*string)}
		if d := r["isDetached"].(*bool); d != nil {
			c.IsDetached = *d
		}
		if p, ok := r["parent"].(object); ok && p != nil {
			id := p["id"].(uint64)
			guid := p["guid"].(string)
			c.ParentForgeID = &id
			c.ParentGUID = &guid
		}
	}
	return m, c
}
func (s *Service) downloadAndInstall(input ForgeDownloadVersionInput, spt, root string, progress Progress) error {
	r, v, err := s.metadata(string(input.Kind), input.ItemID, input.VersionID, spt, "installing", progress)
	if err != nil {
		return err
	}
	progress(models.TaskStageForgeDownload, nil)
	archive, err := s.downloadArchive(v, root, progress)
	if err != nil {
		return err
	}
	defer os.Remove(archive) // Only the generated download, never an input archive.
	m, c := installMetadata(string(input.Kind), input.ItemID, r, v)
	return s.Hooks.Install(input, archive, m, c, progress)
}
func (s *Service) MatchInstalledMod(input ForgeMatchInstalledModInput) (*models.LibraryWorkspace, error) {
	if err := validKind(string(input.Kind)); err != nil {
		return nil, err
	}
	if s.Hooks.AssertLibrary == nil {
		return nil, &Error{Code: "NoActiveLibrary"}
	}
	if err := s.Hooks.AssertLibrary(input.LibraryID); err != nil {
		return nil, err
	}
	spt, err := s.active()
	if err != nil {
		return nil, err
	}
	r, v, err := s.metadata(string(input.Kind), input.ItemID, input.VersionID, spt, "matching", func(models.TaskProgressStage, *float64) {})
	if err != nil {
		return nil, err
	}
	if s.Hooks.Match == nil {
		return nil, fail("Unexpected", "Forge match hook is not initialized")
	}
	m, c := installMetadata(string(input.Kind), input.ItemID, r, v)
	return s.Hooks.Match(input, m, c)
}
func supportedArchiveExtension(name string) string {
	ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(name), "."))
	if ext == "zip" || ext == "7z" {
		return ext
	}
	return ""
}
func archiveExtension(response *http.Response) (string, error) {
	for _, part := range strings.Split(response.Header.Get("Content-Disposition"), ";") {
		key, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if ok && (strings.EqualFold(key, "filename") || strings.EqualFold(key, "filename*")) {
			if ext := supportedArchiveExtension(strings.Trim(strings.TrimSpace(value), `"`)); ext != "" {
				return ext, nil
			}
			break
		}
	}
	if response.Request != nil {
		if ext := supportedArchiveExtension(response.Request.URL.Path); ext != "" {
			return ext, nil
		}
	}
	return "", fail("UnhandledCompression", "Forge download did not identify a supported .zip or .7z archive")
}
func (s *Service) downloadArchive(v object, root string, progress Progress) (path string, err error) {
	req, err := http.NewRequest(http.MethodGet, v["link"].(string), nil)
	if err != nil {
		return "", fail("IOError", "Forge download request failed: "+err.Error())
	}
	req.Header.Set("User-Agent", "Modkeeper")
	res, err := s.Client.HTTP.Do(req)
	if err != nil {
		return "", fail("IOError", "Forge download request failed: "+err.Error())
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", fail("IOError", fmt.Sprintf("Forge download returned HTTP %d", res.StatusCode))
	}
	ext, err := archiveExtension(res)
	if err != nil {
		return "", err
	}
	if err = os.MkdirAll(root, 0755); err != nil {
		return "", fail("IOError", err.Error())
	}
	file, err := os.CreateTemp(root, fmt.Sprintf("forge-%d-%d-*.%s", v["itemId"], v["id"], ext))
	if err != nil {
		return "", fail("IOError", err.Error())
	}
	path = file.Name()
	defer file.Close()
	defer func() {
		if err != nil {
			_ = os.Remove(path)
		}
	}()
	var received uint64
	buffer := make([]byte, 64*1024)
	expected := v["contentLength"].(uint64)
	throttle := task_progress.NewByteThrottle(expected)
	for {
		n, readErr := res.Body.Read(buffer)
		if n > 0 {
			if _, writeErr := file.Write(buffer[:n]); writeErr != nil {
				return path, fail("IOError", "Forge archive staging write failed: "+writeErr.Error())
			}
			received += uint64(n)
			if p := throttle.Update(received, time.Now(), false); p != nil {
				progress(models.TaskStageForgeDownload, p)
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return path, fail("IOError", "Forge archive stream failed: "+readErr.Error())
		}
	}
	if p := throttle.Update(received, time.Now(), true); p != nil {
		progress(models.TaskStageForgeDownload, p)
	}
	info, err := file.Stat()
	if err != nil {
		return path, fail("IOError", err.Error())
	}
	err = verifyDownloadSize(received, uint64(info.Size()), expected, progress)
	return path, err
}
func verifyDownloadSize(received, written, expected uint64, progress Progress) error {
	progress(models.TaskStageForgeSizeVerification, nil)
	if written != received {
		return fail("IOError", "Forge archive staging byte count did not match the received byte count")
	}
	if received != expected {
		return fail("ParseError", fmt.Sprintf("Forge archive size mismatch: expected %d bytes, received %d", expected, received))
	}
	return nil
}
