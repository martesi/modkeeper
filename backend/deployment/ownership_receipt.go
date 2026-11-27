package deployment

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/BurntSushi/toml"
	"github.com/martes/modkeeper/backend/linker"
)

const ownershipKeyName = ".deployment-ownership-key"

func sealDeploymentState(l Layout, state *DeploymentState) error {
	for i := range state.Artifacts {
		artifact := &state.Artifacts[i]
		if filepath.IsAbs(artifact.Target) {
			rel, err := filepath.Rel(l.GameRoot, artifact.Target)
			if err != nil || !safeRelative(rel) {
				return collision(artifact.Target)
			}
			artifact.Target = rel
		}
		if filepath.IsAbs(artifact.Source) {
			rel, err := filepath.Rel(l.LibraryRoot, artifact.Source)
			if err != nil || !safeRelative(rel) {
				return collision(artifact.Source)
			}
			artifact.Source = rel
		}
		if !contained(l.GameRoot, artifact.Target, false) {
			return collision(artifact.Target)
		}
		target := filepath.Join(l.GameRoot, artifact.Target)
		if live, err := liveArtifactMatches(l, *artifact, target); err != nil {
			return ioError(err)
		} else if !live {
			if artifact.FileID == "" || artifact.Receipt == "" || !verifyOwnershipReceipt(l, *artifact, target) {
				artifact.FileID = ""
				artifact.Receipt = ""
			}
			continue
		}
		identity, err := fileIdentity(target)
		if err != nil {
			return ioError(fmt.Errorf("identify deployed object %q for ownership receipt: %w", artifact.Target, err))
		}
		artifact.FileID = identity
		artifact.Receipt, err = signOwnershipReceipt(l, *artifact)
		if err != nil {
			return ioError(fmt.Errorf("sign deployed object %q ownership receipt: %w", artifact.Target, err))
		}
	}
	state.Receipt = ""
	receipt, err := signStateReceipt(l, *state)
	if err != nil {
		return ioError(fmt.Errorf("sign deployment state receipt: %w", err))
	}
	state.Receipt = receipt
	return nil
}

func verifyDeploymentStateReceipt(l Layout, state DeploymentState) bool {
	if state.FileID == "" || state.Receipt == "" {
		return false
	}
	provided := state.Receipt
	state.Receipt = ""
	expected, err := signStateReceipt(l, state)
	return err == nil && hmac.Equal([]byte(expected), []byte(provided))
}

func signStateReceipt(l Layout, state DeploymentState) (string, error) {
	key, err := loadOrCreateOwnershipKey(l)
	if err != nil {
		return "", err
	}
	state.Receipt = ""
	var data bytes.Buffer
	if err := toml.NewEncoder(&data).Encode(state); err != nil {
		return "", err
	}
	libraryRoot, err := filepath.Abs(l.LibraryRoot)
	if err != nil {
		return "", err
	}
	gameRoot, err := filepath.Abs(l.GameRoot)
	if err != nil {
		return "", err
	}
	message := append([]byte("modkeeper-deployment-state-v1\x00"+filepath.Clean(libraryRoot)+"\x00"+filepath.Clean(gameRoot)+"\x00"), data.Bytes()...)
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(message)
	return hex.EncodeToString(mac.Sum(nil)), nil
}

func verifyOwnershipReceipt(l Layout, artifact DeploymentArtifact, target string) bool {
	if artifact.FileID == "" || artifact.Receipt == "" {
		return false
	}
	if artifact.Kind == linker.Copy {
		if artifact.Fingerprint == nil {
			return false
		}
		fingerprint, err := fingerprint(target)
		if err != nil || fingerprint != *artifact.Fingerprint {
			return false
		}
	}
	identity, err := fileIdentity(target)
	if err != nil || identity != artifact.FileID {
		return false
	}
	expected, err := signOwnershipReceipt(l, artifact)
	return err == nil && hmac.Equal([]byte(expected), []byte(artifact.Receipt))
}

func signOwnershipReceipt(l Layout, artifact DeploymentArtifact) (string, error) {
	key, err := loadOrCreateOwnershipKey(l)
	if err != nil {
		return "", err
	}
	libraryRoot, err := filepath.Abs(l.LibraryRoot)
	if err != nil {
		return "", err
	}
	gameRoot, err := filepath.Abs(l.GameRoot)
	if err != nil {
		return "", err
	}
	fingerprint := ""
	if artifact.Fingerprint != nil {
		fingerprint = *artifact.Fingerprint
	}
	message := strings.Join([]string{
		"modkeeper-deployment-receipt-v1",
		filepath.Clean(libraryRoot), filepath.Clean(gameRoot),
		pathKey(artifact.Target), pathKey(artifact.Source), string(artifact.Kind),
		artifact.FileID, fingerprint,
	}, "\x00")
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(message))
	return hex.EncodeToString(mac.Sum(nil)), nil
}

func signSyncIntentRecord(l Layout, path string, record *syncIntent) error {
	identity, err := fileIdentity(path)
	if err != nil {
		return err
	}
	record.JournalID = identity
	record.Receipt = ""
	var data bytes.Buffer
	if err := toml.NewEncoder(&data).Encode(record); err != nil {
		return err
	}
	key, err := loadOrCreateOwnershipKey(l)
	if err != nil {
		return err
	}
	message := append([]byte("modkeeper-sync-intent-v1\x00"+syncJournalKey(path)+"\x00"+identity+"\x00"), data.Bytes()...)
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(message)
	record.Receipt = hex.EncodeToString(mac.Sum(nil))
	return nil
}

func verifySyncIntentRecord(l Layout, path string, record syncIntent) bool {
	identity, err := fileIdentity(path)
	if err != nil || identity != record.JournalID || record.Receipt == "" {
		return false
	}
	provided := record.Receipt
	record.Receipt = ""
	var data bytes.Buffer
	if err := toml.NewEncoder(&data).Encode(record); err != nil {
		return false
	}
	key, err := loadOrCreateOwnershipKey(l)
	if err != nil {
		return false
	}
	message := append([]byte("modkeeper-sync-intent-v1\x00"+syncJournalKey(path)+"\x00"+identity+"\x00"), data.Bytes()...)
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write(message)
	return hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(provided))
}

func loadOrCreateOwnershipKey(l Layout) ([]byte, error) {
	path := filepath.Join(l.LibraryRoot, ownershipKeyName)
	if _, err := os.Lstat(path); err == nil {
		info, statErr := os.Lstat(path)
		if statErr != nil {
			return nil, statErr
		}
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("ownership key is not a regular file")
		}
		key, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil, readErr
		}
		if len(key) != sha256.Size {
			return nil, fmt.Errorf("ownership key has an invalid length")
		}
		return key, nil
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	key := make([]byte, sha256.Size)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		if os.IsExist(err) {
			return loadOrCreateOwnershipKey(l)
		}
		return nil, err
	}
	written, writeErr := file.Write(key)
	if writeErr == nil && written != len(key) {
		writeErr = io.ErrShortWrite
	}
	if writeErr == nil {
		writeErr = file.Sync()
	}
	closeErr := file.Close()
	if writeErr != nil {
		return nil, writeErr
	}
	if closeErr != nil {
		return nil, closeErr
	}
	if err := syncDirectoryDurably(l.LibraryRoot); err != nil {
		return nil, err
	}
	return key, nil
}
