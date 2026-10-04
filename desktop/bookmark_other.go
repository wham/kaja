//go:build !darwin || ios

package main

import "fmt"

func CreateBookmark(path string) ([]byte, error) {
	return nil, fmt.Errorf("bookmarks not supported on this platform")
}

func ResolveBookmark(bookmarkData []byte) (path string, isStale bool, err error) {
	return "", false, fmt.Errorf("bookmarks not supported on this platform")
}

func StopAccessing(path string) {}

type BookmarkStore struct{}

type bookmarkEntry struct {
	Key string
}

func NewBookmarkStore(path string) *BookmarkStore { return &BookmarkStore{} }

// There are no bookmarks to restore off a sandbox this platform doesn't have,
// which is a stand-in the package needs to compile rather than a feature.
func (s *BookmarkStore) loadEntries() ([]bookmarkEntry, error) { return nil, nil }

func (s *BookmarkStore) Save(key string, dirPath string) error {
	return nil
}

func (s *BookmarkStore) Restore(key string) (string, error) {
	return "", fmt.Errorf("bookmarks not supported on this platform")
}
