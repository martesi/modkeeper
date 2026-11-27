package deployment

import (
	"fmt"
	"path/filepath"
)

// MutationLock keeps a library's cross-process mutation lock across a sequence
// such as ownership validation followed by library deletion.
type MutationLock struct {
	layout  Layout
	release func()
}

func LockMutations(l Layout) (*MutationLock, error) {
	release, err := acquireMutationLock(l)
	if err != nil {
		return nil, ioError(fmt.Errorf("lock deployment mutations: %w", err))
	}
	return &MutationLock{layout: l, release: release}, nil
}

func (m *MutationLock) Close() {
	if m != nil && m.release != nil {
		m.release()
		m.release = nil
	}
}

func (m *MutationLock) check(l Layout) error {
	if m == nil || m.release == nil {
		return invalid(l, "Deployment mutation lock is not active")
	}
	lockedRoot, err := filepath.EvalSymlinks(m.layout.LibraryRoot)
	if err != nil {
		return ioError(err)
	}
	requestedRoot, err := filepath.EvalSymlinks(l.LibraryRoot)
	if err != nil || filepath.Clean(lockedRoot) != filepath.Clean(requestedRoot) {
		return invalid(l, "Deployment mutation lock belongs to another library")
	}
	return CheckNoPendingSync(l)
}

func (m *MutationLock) VerifyOwnership() error {
	if err := m.check(m.layout); err != nil {
		return err
	}
	return verifyOwnership(m.layout)
}

func (m *MutationLock) CheckNoPendingSync() error {
	if m == nil {
		return invalid(Layout{}, "Deployment mutation lock is not active")
	}
	return m.check(m.layout)
}

func (m *MutationLock) ValidatePurge() error {
	if err := m.check(m.layout); err != nil {
		return err
	}
	_, err := planPurge(m.layout)
	return err
}

func (m *MutationLock) Purge() error {
	if err := m.check(m.layout); err != nil {
		return err
	}
	return purge(m.layout, nil)
}
