package models

import (
	"encoding/json"
	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/config"
	"testing"
)

func assertJSON(t *testing.T, value any, want string) {
	t.Helper()
	got, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != want {
		t.Fatalf("got %s\nwant %s", got, want)
	}
}
func TestLibraryEntryWireShapes(t *testing.T) {
	for _, tc := range []struct {
		entry LibraryEntry
		want  string
	}{
		{StubEntry("/unreadable"), `{"path":"/unreadable"}`},
		{SummaryEntry(LibrarySummary{ID: "id", Name: "name", GameRoot: "game", LibraryRoot: "library", CacheStatus: CacheStatus{State: CacheStateReady}, UpdatedAt: "now", TargetRuntime: TargetWindows, DeploymentMethod: DeploymentMethodCopyFirst, HostRuntime: "linux"}), `{"id":"id","name":"name","gameRoot":"game","libraryRoot":"library","cacheStatus":{"state":"ready"},"deployStale":false,"updatedAt":"now","targetRuntime":"windows","deploymentMethod":"copy-first","policyUncertain":false,"hostRuntime":"linux"}`},
	} {
		assertJSON(t, tc.entry, tc.want)
		var decoded LibraryEntry
		if err := json.Unmarshal([]byte(tc.want), &decoded); err != nil {
			t.Fatal(err)
		}
		assertJSON(t, decoded, tc.want)
	}
	for _, invalid := range []string{`null`, `{}`, `{"id":"x"}`, `{"path":null}`} {
		var entry LibraryEntry
		if json.Unmarshal([]byte(invalid), &entry) == nil {
			t.Fatalf("accepted %s", invalid)
		}
	}
}
func TestExistingCompletionEventPayloadsKeepTheirWireShapes(t *testing.T) {
	workspace := LibraryWorkspace{Libraries: []LibraryEntry{}, ModsByLibraryID: map[string][]ModSummary{}, ToolsByLibraryID: map[string][]ToolSummary{}, Settings: config.DefaultSettings()}
	const wire = `{"libraries":[],"modsByLibraryId":{},"toolsByLibraryId":{},"settings":{"theme":"system","accentColor":"default","language":"en-US","enableModsOnInstall":true,"warnIncompatibleForgeInstall":true,"forgeEndpoint":""}}`
	for _, kind := range []string{WorkspaceEventSyncCompleted, WorkspaceEventModInstallCompleted, WorkspaceEventCacheRebuildCompleted} {
		event := WorkspaceEvent{Type: kind, TaskID: "task", LibraryID: "library", Workspace: workspace}
		middle := `"failures":[],`
		if kind == WorkspaceEventSyncCompleted {
			event.Status = SyncSuccess
			middle = `"failures":[],"status":"success",`
		}
		if kind == WorkspaceEventCacheRebuildCompleted {
			event.CacheStatus = &CacheStatus{State: CacheStateReady}
			middle = `"cacheStatus":{"state":"ready"},`
		}
		want := `{"type":"` + kind + `","taskId":"task","libraryId":"library",` + middle + `"workspace":` + wire + `}`
		assertJSON(t, event, want)
		var decoded WorkspaceEvent
		if err := json.Unmarshal([]byte(want), &decoded); err != nil {
			t.Fatal(err)
		}
		assertJSON(t, decoded, want)
	}
}

func TestSyncFailureCompletionRoundTripsCauseAndModFailures(t *testing.T) {
	event := WorkspaceEvent{Type: WorkspaceEventSyncCompleted, TaskID: "task", LibraryID: "library", Status: SyncFailure, Cause: SyncCauseFinalPersistence, Failures: []ModFailure{{ModID: "mod", Error: Error{Code: "Unexpected"}}}}
	data, err := json.Marshal(event)
	if err != nil {
		t.Fatal(err)
	}
	var decoded WorkspaceEvent
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Status != event.Status || decoded.Cause != event.Cause || len(decoded.Failures.([]ModFailure)) != 1 {
		t.Fatalf("completion round trip: %+v", decoded)
	}
}
func TestOldManifestModsDefaultToLocalWithoutRegistryIdentity(t *testing.T) {
	var mod Mod
	_, err := toml.Decode("id = \"old-install\"\nisActive = true\ntype = \"Server\"\nname = \"Existing Mod\"\ninstalledAt = \"2026-01-02T03:04:05Z\"\n", &mod)
	if err != nil {
		t.Fatal(err)
	}
	if mod.Source != ModSourceLocal || mod.Type != ModTypeServer || !mod.Enabled || mod.ForgeID != nil || mod.Version != nil {
		t.Fatalf("wrong defaults: %+v", mod)
	}
	assertJSON(t, mod, `{"id":"old-install","isActive":true,"type":"server","name":"Existing Mod","installedAt":"2026-01-02T03:04:05Z","source":"local"}`)
}
func TestErrorWireShape(t *testing.T) {
	assertJSON(t, Fail(NoActiveLibrary), `{"code":"NoActiveLibrary","data":null}`)
	assertJSON(t, Fail(ModNotFound, "id"), `{"code":"ModNotFound","data":"id"}`)
	assertJSON(t, Fail(InvalidLibrary, "path", "reason"), `{"code":"InvalidLibrary","data":["path","reason"]}`)
	assertJSON(t, Fail(FileCollision, []string{"a", "b"}), `{"code":"FileCollision","data":["a","b"]}`)
}
