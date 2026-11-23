package deployment

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func purgeFixture(t *testing.T) (Layout, string, string) {
	t.Helper()
	l := fixture(t)
	target := filepath.Join(l.LibraryRoot, "target")
	write(t, target, "library")
	root := filepath.Join(l.GameRoot, l.Rules.ServerMods)
	must(t, os.MkdirAll(root, 0755))
	return l, root, target
}
func TestPurgePreflightsAllProtectedRootsBeforeTraversal(t *testing.T) {
	l, root, target := purgeFixture(t)
	link := filepath.Join(root, "keep")
	must(t, os.Symlink(target, link))
	other := t.TempDir()
	must(t, os.Symlink(other, filepath.Join(l.GameRoot, "BepInEx")))
	code(t, Purge(l, nil), "InvalidLibrary")
	content(t, link, "library")
}
func TestPurgePreflightsAllWalksBeforeUnlinkingLinks(t *testing.T) {
	l, root, target := purgeFixture(t)
	link := filepath.Join(root, "keep")
	must(t, os.Symlink(target, link))
	write(t, filepath.Join(l.GameRoot, l.Rules.ClientPlugins, "invalid-\xff"), "bad")
	code(t, Purge(l, nil), "Unexpected")
	content(t, link, "library")
}
func TestPurgeResolvesRelativeLinkTargetsFromTheLinkParent(t *testing.T) {
	l, root, target := purgeFixture(t)
	relative, e := filepath.Rel(root, target)
	must(t, e)
	link := filepath.Join(root, "relative")
	must(t, os.Symlink(relative, link))
	external := filepath.Join(t.TempDir(), "external")
	write(t, external, "outside")
	relative, e = filepath.Rel(root, external)
	must(t, e)
	outsideLink := filepath.Join(root, "external")
	must(t, os.Symlink(relative, outsideLink))
	must(t, Purge(l, nil))
	absent(t, link)
	content(t, outsideLink, "outside")
	content(t, target, "library")
	absent(t, journal(l))
}
func TestPurgeKeepsDanglingExternalTargetsUnverified(t *testing.T) {
	l, root, _ := purgeFixture(t)
	link := filepath.Join(root, "dangling")
	raw := filepath.Join(l.LibraryRoot, "../outside/missing")
	must(t, os.Symlink(raw, link))
	must(t, Purge(l, nil))
	got, e := os.Readlink(link)
	must(t, e)
	if got != raw {
		t.Fatal(got)
	}
}
func TestPurgeHandlesNonUtf8LinkTargetsWithoutRecreatingThem(t *testing.T) {
	l, root, _ := purgeFixture(t)
	target := filepath.Join(l.LibraryRoot, "target-\xff")
	write(t, target, "library")
	link := filepath.Join(root, "non-utf8-target")
	must(t, os.Symlink(target, link))
	must(t, Purge(l, nil))
	absent(t, link)
	content(t, target, "library")
}
func TestPurgeHandlesLongLinkNamesWithABoundedQuarantineName(t *testing.T) {
	l, root, target := purgeFixture(t)
	link := filepath.Join(root, strings.Repeat("l", 202))
	must(t, os.Symlink(target, link))
	must(t, Purge(l, nil))
	absent(t, link)
	absent(t, journal(l))
}
func TestPurgeBlocksAnOrphanedQuarantineLinkOnRetry(t *testing.T) {
	l, root, target := purgeFixture(t)
	link := filepath.Join(root, ".mkp-orphan")
	must(t, os.Symlink(target, link))
	code(t, Purge(l, nil), "InvalidLibrary")
	content(t, link, "library")
}
func TestPurgeBlocksARetainedRecoveryManifestOnRetry(t *testing.T) {
	l, root, target := purgeFixture(t)
	link := filepath.Join(root, "keep")
	must(t, os.Symlink(target, link))
	write(t, journal(l), "version = 2\ntoken = 'test'\nentries = []\n")
	code(t, Purge(l, nil), "InvalidLibrary")
	content(t, link, "library")
	content(t, journal(l), "version = 2\ntoken = 'test'\nentries = []\n")
}
func TestPurgePreflightsLinkParentPermissionsBeforeUnlinking(t *testing.T) {
	l, root, target := purgeFixture(t)
	link := filepath.Join(root, "keep")
	must(t, os.Symlink(target, link))
	client := filepath.Join(l.GameRoot, l.Rules.ClientPlugins)
	must(t, os.MkdirAll(client, 0755))
	clientLink := filepath.Join(client, "keep")
	must(t, os.Symlink(target, clientLink))
	must(t, os.Chmod(client, 0555))
	defer os.Chmod(client, 0755)
	code(t, Purge(l, nil), "IOError")
	content(t, link, "library")
	content(t, clientLink, "library")
	absent(t, journal(l))
}
func TestPurgeNeverFollowsExternalDirectoryLinks(t *testing.T) {
	l, root, target := purgeFixture(t)
	external := t.TempDir()
	inside := filepath.Join(external, "keep")
	must(t, os.Symlink(target, inside))
	must(t, os.Symlink(external, filepath.Join(root, "external")))
	must(t, Purge(l, nil))
	content(t, inside, "library")
}
func TestPurgeKeepsARecoveryManifestWhenItsQuarantineIsMissing(t *testing.T) {
	l, root, _ := purgeFixture(t)
	original := filepath.Join(root, "original-link")
	quarantine := filepath.Join(root, ".mkp-missing")
	write(t, journal(l), "version = 2\ntoken = 'test'\nentries = []\n")
	code(t, Purge(l, nil), "InvalidLibrary")
	content(t, journal(l), "version = 2\ntoken = 'test'\nentries = []\n")
	absent(t, original)
	absent(t, quarantine)
}
