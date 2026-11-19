package deployment

import (
	"github.com/BurntSushi/toml"
	"os"
)

func encodeJournal(f *os.File, record purgeRecovery) error {
	if e := toml.NewEncoder(f).Encode(record); e != nil {
		return e
	}
	return f.Sync()
}

func clearJournal(l Layout, token string) error {
	info, err := os.Lstat(journal(l))
	if err != nil {
		return ioError(err)
	}
	if !info.Mode().IsRegular() {
		return invalid(l, "Purge recovery manifest was replaced")
	}
	var record purgeRecovery
	if _, err = toml.DecodeFile(journal(l), &record); err != nil {
		return invalid(l, "Purge recovery manifest cannot be verified")
	}
	if record.Version != 2 || record.Token != token {
		return invalid(l, "Purge recovery manifest is owned by another operation")
	}
	if err = os.Remove(journal(l)); err != nil {
		return ioError(err)
	}
	return ioError(syncDir(l.LibraryRoot))
}
