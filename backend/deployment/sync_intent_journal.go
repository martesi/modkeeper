package deployment

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"sync"

	"github.com/BurntSushi/toml"
)

type syncIntentJournalDisk struct {
	Records []syncIntent `toml:"records"`
}

type liveSyncJournal struct {
	file    *os.File
	object  pinnedObject
	records []syncIntent
	retired map[string]bool
}

var liveSyncJournals = struct {
	sync.Mutex
	byPath map[string]*liveSyncJournal
}{byPath: map[string]*liveSyncJournal{}}

const syncOperationJournalPrefix = ".sync-intent-op-"

func syncOperationJournalPath(l Layout, token string) string {
	return filepath.Join(l.LibraryRoot, syncOperationJournalPrefix+token+".toml")
}

func syncIntentPathForNewOperation(l Layout, token string) (string, error) {
	paths, err := syncIntentJournalPaths(l)
	if err != nil {
		return "", ioError(err)
	}
	for _, path := range paths {
		if _, err := os.Lstat(path); err == nil {
			return syncOperationJournalPath(l, token), nil
		} else if !os.IsNotExist(err) {
			return "", ioError(err)
		}
	}
	return l.Paths().SyncIntent, nil
}

func syncIntentJournalPaths(l Layout) ([]string, error) {
	entries, err := os.ReadDir(l.LibraryRoot)
	if err != nil {
		return nil, fmt.Errorf("inspect Sync intent journals: %w", err)
	}
	paths := []string{l.Paths().SyncIntent}
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, syncOperationJournalPrefix) && strings.HasSuffix(name, ".toml") {
			paths = append(paths, filepath.Join(l.LibraryRoot, name))
		}
	}
	sort.Strings(paths)
	return paths, nil
}

func syncIntentPathForToken(l Layout, token string) (string, error) {
	paths, err := syncIntentJournalPaths(l)
	if err != nil {
		return "", ioError(err)
	}
	for _, path := range paths {
		if _, err := os.Lstat(path); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return "", ioError(err)
		}
		records, err := readSyncIntentRecords(path)
		if err != nil {
			return "", syncIntentConflict(l, path)
		}
		for _, record := range records {
			if record.Token == token && !record.Completed {
				return path, nil
			}
		}
	}
	return "", syncIntentConflict(l, l.Paths().SyncIntent)
}

func syncJournalKey(path string) string {
	key := filepath.Clean(path)
	if runtime.GOOS == "windows" {
		key = strings.ToLower(key)
	}
	return key
}

func readSyncIntentRecords(path string) ([]syncIntent, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return decodeSyncIntentRecords(data)
}

func decodeSyncIntentRecords(data []byte) ([]syncIntent, error) {
	var journal syncIntentJournalDisk
	if _, err := toml.Decode(string(data), &journal); err == nil && journal.Records != nil {
		if len(journal.Records) == 0 {
			return nil, fmt.Errorf("Sync intent journal has no records")
		}
		return journal.Records, nil
	}
	// Preserve and recognize the earlier single-record format. It has no live
	// journal pin after restart, so callers keep it as a blocker.
	var legacy syncIntent
	if _, err := toml.Decode(string(data), &legacy); err != nil || legacy.Version == 0 {
		if err == nil {
			err = fmt.Errorf("unsupported Sync intent journal format")
		}
		return nil, err
	}
	return []syncIntent{legacy}, nil
}

func validateOperationJournalPath(path string, records []syncIntent) error {
	name := filepath.Base(path)
	if !strings.HasPrefix(name, syncOperationJournalPrefix) || !strings.HasSuffix(name, ".toml") {
		return nil
	}
	token := strings.TrimSuffix(strings.TrimPrefix(name, syncOperationJournalPrefix), ".toml")
	if token == "" || len(records) == 0 || len(records) > 2 {
		return fmt.Errorf("invalid per-operation Sync journal path or record count")
	}
	for _, record := range records {
		if record.Token != token {
			return fmt.Errorf("per-operation Sync journal token does not match its path")
		}
	}
	return nil
}

func syncJournalCompletionState(records []syncIntent) (map[string]bool, error) {
	completed := map[string]bool{}
	intents := map[string]bool{}
	for _, record := range records {
		if record.Token == "" {
			return nil, fmt.Errorf("Sync journal record has no token")
		}
		if record.Completed {
			if record.Version != syncIntentVersion || !intents[record.Token] || completed[record.Token] || len(record.Targets) != 0 || record.LibraryRoot != "" || record.GameRoot != "" {
				return nil, fmt.Errorf("Sync journal has an invalid completion record")
			}
			completed[record.Token] = true
			continue
		}
		if record.Version != syncIntentVersion || record.Targets == nil || intents[record.Token] {
			return nil, fmt.Errorf("Sync journal has an invalid intent record")
		}
		intents[record.Token] = true
		completed[record.Token] = false
	}
	return completed, nil
}

func encodeSyncIntentRecord(intent syncIntent) ([]byte, error) {
	var data bytes.Buffer
	err := toml.NewEncoder(&data).Encode(syncIntentJournalDisk{Records: []syncIntent{intent}})
	return data.Bytes(), err
}

func liveSyncJournalFor(path string) *liveSyncJournal {
	liveSyncJournals.Lock()
	journal := liveSyncJournals.byPath[syncJournalKey(path)]
	liveSyncJournals.Unlock()
	return journal
}

func adoptAuthenticatedSyncJournal(l Layout, path string, records []syncIntent) error {
	if liveSyncJournalFor(path) != nil {
		return nil
	}
	completed, err := syncJournalCompletionState(records)
	if err != nil {
		return syncIntentConflict(l, path)
	}
	retired := map[string]bool{}
	for _, record := range records {
		if !verifySyncIntentRecord(l, path, record) {
			return syncIntentConflict(l, path)
		}
		if record.Completed {
			retired[record.Token] = true
		}
	}
	unresolved := false
	for token, done := range completed {
		if !done {
			unresolved = true
			retired[token] = false
		}
	}
	if !unresolved {
		return syncIntentConflict(l, path)
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0600)
	if err != nil {
		return ioError(fmt.Errorf("open authenticated Sync journal for recovery: %w", err))
	}
	object, err := pinOpenFile(file)
	if err != nil {
		_ = file.Close()
		return ioError(fmt.Errorf("pin authenticated Sync journal for recovery: %w", err))
	}
	owned, err := object.matches(path)
	if err != nil || !owned {
		_ = object.close()
		_ = file.Close()
		if err != nil {
			return ioError(fmt.Errorf("verify authenticated Sync journal for recovery: %w", err))
		}
		return syncIntentConflict(l, path)
	}
	key := syncJournalKey(path)
	liveSyncJournals.Lock()
	if _, exists := liveSyncJournals.byPath[key]; exists {
		liveSyncJournals.Unlock()
		_ = object.close()
		_ = file.Close()
		return syncIntentConflict(l, path)
	}
	liveSyncJournals.byPath[key] = &liveSyncJournal{file: file, object: object, records: records, retired: retired}
	liveSyncJournals.Unlock()
	return nil
}

func verifyLiveSyncJournal(l Layout, path string, journal *liveSyncJournal) error {
	if journal == nil || journal.object == nil || journal.file == nil {
		return syncIntentConflict(l, path)
	}
	owned, err := journal.object.matches(path)
	if err != nil {
		return ioError(fmt.Errorf("verify live Sync journal %q: %w", path, err))
	}
	if !owned {
		return syncIntentConflict(l, path)
	}
	records, err := readSyncIntentRecords(path)
	if err != nil {
		return syncIntentConflict(l, path)
	}
	if !reflect.DeepEqual(records, journal.records) {
		return syncIntentConflict(l, path)
	}
	for _, record := range records {
		if !verifySyncIntentRecord(l, path, record) {
			return syncIntentConflict(l, path)
		}
	}
	return nil
}

func appendSyncIntentRecord(l Layout, path string, intent syncIntent, data []byte) error {
	return appendSyncIntentRecordWithFlush(l, path, intent, data, syncDirectoryDurably)
}

func appendSyncIntentCompletion(l Layout, path string, token string) error {
	journal := liveSyncJournalFor(path)
	if err := verifyLiveSyncJournal(l, path, journal); err != nil {
		return err
	}
	if journal.retired[token] {
		return syncIntentConflict(l, path)
	}
	completion := syncIntent{Version: syncIntentVersion, Token: token, Completed: true}
	if err := signSyncIntentRecord(l, path, &completion); err != nil {
		return ioError(fmt.Errorf("sign Sync intent completion record: %w", err))
	}
	data, err := encodeSyncIntentRecord(completion)
	if err != nil {
		return ioError(fmt.Errorf("encode Sync intent completion record: %w", err))
	}
	if _, err := journal.file.Write(data); err != nil {
		return ioError(fmt.Errorf("append Sync intent completion record: %w", err))
	}
	if err := journal.file.Sync(); err != nil {
		return ioError(fmt.Errorf("sync Sync intent completion record: %w", err))
	}
	journal.records = append(journal.records, completion)
	journal.retired[token] = true
	if err := verifyLiveSyncJournal(l, path, journal); err != nil {
		return err
	}
	return nil
}

func appendSyncIntentRecordWithFlush(l Layout, path string, intent syncIntent, data []byte, flushDir func(string) error) error {
	key := syncJournalKey(path)
	journal := liveSyncJournalFor(path)
	if journal == nil {
		if _, err := os.Lstat(path); err == nil {
			return syncIntentConflict(l, path)
		} else if !os.IsNotExist(err) {
			return ioError(fmt.Errorf("inspect Sync intent journal before creation: %w", err))
		}
		file, err := createSyncJournalFile(path)
		if err != nil {
			if os.IsExist(err) {
				return syncIntentConflict(l, path)
			}
			return ioError(fmt.Errorf("create Sync intent journal: %w", err))
		}
		if err = signSyncIntentRecord(l, path, &intent); err == nil {
			data, err = encodeSyncIntentRecord(intent)
		}
		if err == nil {
			_, err = file.Write(data)
		}
		if err == nil {
			err = file.Sync()
		}
		if err != nil {
			_ = file.Close()
			return ioError(fmt.Errorf("write Sync intent journal: %w", err))
		}
		object, pinErr := pinOpenFile(file)
		if pinErr != nil {
			_ = file.Close()
			return ioError(fmt.Errorf("pin Sync intent journal: %w", pinErr))
		}
		if err := flushDir(l.LibraryRoot); err != nil {
			_ = object.close()
			_ = file.Close()
			return ioError(fmt.Errorf("sync library root after Sync intent journal creation: %w", err))
		}
		owned, err := object.matches(path)
		if err != nil || !owned {
			_ = object.close()
			_ = file.Close()
			if err != nil {
				return ioError(fmt.Errorf("verify Sync intent journal after creation: %w", err))
			}
			return syncIntentConflict(l, path)
		}
		liveSyncJournals.Lock()
		if _, exists := liveSyncJournals.byPath[key]; exists {
			liveSyncJournals.Unlock()
			_ = object.close()
			_ = file.Close()
			return syncIntentConflict(l, path)
		}
		liveSyncJournals.byPath[key] = &liveSyncJournal{
			file: file, object: object, records: []syncIntent{intent},
			retired: map[string]bool{intent.Token: false},
		}
		liveSyncJournals.Unlock()
		return nil
	}
	if err := verifyLiveSyncJournal(l, path, journal); err != nil {
		return err
	}
	for _, record := range journal.records {
		if !journal.retired[record.Token] {
			return syncIntentConflict(l, path)
		}
	}
	if err := signSyncIntentRecord(l, path, &intent); err != nil {
		return ioError(fmt.Errorf("sign appended Sync intent record: %w", err))
	}
	data, err := encodeSyncIntentRecord(intent)
	if err != nil {
		return ioError(fmt.Errorf("encode appended Sync intent record: %w", err))
	}
	if _, err := journal.file.Write(data); err != nil {
		return ioError(fmt.Errorf("append Sync intent journal: %w", err))
	}
	if err := journal.file.Sync(); err != nil {
		return ioError(fmt.Errorf("sync appended Sync intent journal: %w", err))
	}
	journal.records = append(journal.records, intent)
	journal.retired[intent.Token] = false
	if err := verifyLiveSyncJournal(l, path, journal); err != nil {
		return err
	}
	return nil
}

func liveJournalRecords(l Layout, path string) ([]syncIntent, *liveSyncJournal, error) {
	journal := liveSyncJournalFor(path)
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		if journal != nil {
			return nil, journal, syncIntentConflict(l, path)
		}
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, ioError(fmt.Errorf("inspect Sync intent journal %q: %w", path, err))
	}
	if !info.Mode().IsRegular() {
		return nil, nil, syncIntentConflict(l, path)
	}
	if journal == nil {
		// A completed record can establish transaction status, but not journal
		// pathname ownership. Keep it read-only after restart; later appends must
		// fail rather than pinning a possibly substituted file.
		records, readErr := readSyncIntentRecords(path)
		if readErr != nil {
			return nil, nil, syncIntentConflict(l, path)
		}
		if validateOperationJournalPath(path, records) != nil {
			return nil, nil, syncIntentConflict(l, path)
		}
		_, stateErr := syncJournalCompletionState(records)
		if stateErr != nil {
			return nil, nil, syncIntentConflict(l, path)
		}
		for _, record := range records {
			if !record.Completed && validateSyncIntentShape(l, record) != nil {
				return nil, nil, syncIntentConflict(l, path)
			}
			if !verifySyncIntentRecord(l, path, record) {
				return nil, nil, syncIntentConflict(l, path)
			}
		}
		return records, nil, nil
	}
	if err := verifyLiveSyncJournal(l, path, journal); err != nil {
		return nil, journal, err
	}
	if validateOperationJournalPath(path, journal.records) != nil {
		return nil, journal, syncIntentConflict(l, path)
	}
	return journal.records, journal, nil
}

func hasCompletedUnpinnedSyncJournal(l Layout) bool {
	path := l.Paths().SyncIntent
	if liveSyncJournalFor(path) != nil {
		return false
	}
	records, err := readSyncIntentRecords(path)
	if err != nil {
		return false
	}
	completed, err := syncJournalCompletionState(records)
	if err != nil || len(completed) == 0 {
		return false
	}
	for _, record := range records {
		if record.Completed {
			continue
		}
		if !completed[record.Token] || validateSyncIntentShape(l, record) != nil {
			return false
		}
	}
	return true
}
