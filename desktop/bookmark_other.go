//go:build !darwin

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

func NewBookmarkStore(path string) *BookmarkStore { return &BookmarkStore{} }

func (s *BookmarkStore) Save(key string, dirPath string) error {
	return nil
}

func (s *BookmarkStore) Restore(key string) (string, error) {
	return "", fmt.Errorf("bookmarks not supported on this platform")
}
