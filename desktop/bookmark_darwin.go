package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Foundation

#import <Foundation/Foundation.h>
#include <stdlib.h>

// createBookmark creates an app-scoped security-scoped bookmark from a file path.
// Returns the bookmark data as bytes, or NULL on failure.
static void* createBookmark(const char* path, int* outLen) {
    @autoreleasepool {
        NSString *nsPath = [NSString stringWithUTF8String:path];
        NSURL *url = [NSURL fileURLWithPath:nsPath];

        NSError *error = nil;
        NSData *bookmark = [url bookmarkDataWithOptions:NSURLBookmarkCreationWithSecurityScope
                        includingResourceValuesForKeys:nil
                                         relativeToURL:nil
                                                 error:&error];
        if (error != nil || bookmark == nil) {
            *outLen = 0;
            return NULL;
        }

        *outLen = (int)[bookmark length];
        void *buf = malloc(*outLen);
        memcpy(buf, [bookmark bytes], *outLen);
        return buf;
    }
}

// resolveBookmark resolves a security-scoped bookmark and returns the path.
// The caller must call startAccessingSecurityScopedResource on the resolved URL.
// Returns the resolved path, or NULL on failure. Sets *isStale if the bookmark is stale.
static const char* resolveBookmark(const void* data, int dataLen, int* isStale) {
    @autoreleasepool {
        NSData *bookmarkData = [NSData dataWithBytes:data length:dataLen];

        BOOL stale = NO;
        NSError *error = nil;
        NSURL *url = [NSURL URLByResolvingBookmarkData:bookmarkData
                                               options:NSURLBookmarkResolutionWithSecurityScope
                                         relativeToURL:nil
                                   bookmarkDataIsStale:&stale
                                                 error:&error];
        *isStale = stale ? 1 : 0;

        if (error != nil || url == nil) {
            return NULL;
        }

        [url startAccessingSecurityScopedResource];

        const char *path = [[url path] UTF8String];
        return strdup(path);
    }
}

// stopAccessing stops accessing a security-scoped resource.
static void stopAccessing(const char* path) {
    @autoreleasepool {
        NSString *nsPath = [NSString stringWithUTF8String:path];
        NSURL *url = [NSURL fileURLWithPath:nsPath];
        [url stopAccessingSecurityScopedResource];
    }
}
*/
import "C"
import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"unsafe"
)

// CreateBookmark creates an app-scoped security-scoped bookmark for the given path.
// Returns the bookmark data as a byte slice.
func CreateBookmark(path string) ([]byte, error) {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))

	var outLen C.int
	data := C.createBookmark(cPath, &outLen)
	if data == nil {
		return nil, fmt.Errorf("failed to create bookmark for %s", path)
	}
	defer C.free(data)

	return C.GoBytes(data, outLen), nil
}

// ResolveBookmark resolves a security-scoped bookmark and starts accessing
// the security-scoped resource. Call StopAccessing when done.
// Returns the resolved path and whether the bookmark is stale.
func ResolveBookmark(bookmarkData []byte) (path string, isStale bool, err error) {
	if len(bookmarkData) == 0 {
		return "", false, fmt.Errorf("empty bookmark data")
	}

	var stale C.int
	cPath := C.resolveBookmark(unsafe.Pointer(&bookmarkData[0]), C.int(len(bookmarkData)), &stale)
	if cPath == nil {
		return "", false, fmt.Errorf("failed to resolve bookmark")
	}
	defer C.free(unsafe.Pointer(cPath))

	return C.GoString(cPath), stale != 0, nil
}

// StopAccessing stops accessing a security-scoped resource.
func StopAccessing(path string) {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))
	C.stopAccessing(cPath)
}

// BookmarkStore persists security-scoped bookmarks to disk so directory
// access survives app restarts under App Sandbox.
type BookmarkStore struct {
	path string
}

type bookmarkEntry struct {
	Key      string `json:"key"`
	Bookmark string `json:"bookmark"` // base64-encoded bookmark data
}

// NewBookmarkStore creates a store that reads/writes bookmarks at the given path.
func NewBookmarkStore(path string) *BookmarkStore {
	return &BookmarkStore{path: path}
}

// Save creates a bookmark for dirPath and persists it under the given key.
func (s *BookmarkStore) Save(key string, dirPath string) error {
	data, err := CreateBookmark(dirPath)
	if err != nil {
		return err
	}

	entries, _ := s.loadEntries()

	// Update or append
	found := false
	for i, e := range entries {
		if e.Key == key {
			entries[i].Bookmark = base64.StdEncoding.EncodeToString(data)
			found = true
			break
		}
	}
	if !found {
		entries = append(entries, bookmarkEntry{
			Key:      key,
			Bookmark: base64.StdEncoding.EncodeToString(data),
		})
	}

	return s.saveEntries(entries)
}

// Restore resolves the bookmark for the given key and starts accessing it.
// Returns the resolved path. The caller should call StopAccessing when done.
func (s *BookmarkStore) Restore(key string) (string, error) {
	entries, err := s.loadEntries()
	if err != nil {
		return "", err
	}

	for _, e := range entries {
		if e.Key == key {
			data, err := base64.StdEncoding.DecodeString(e.Bookmark)
			if err != nil {
				return "", fmt.Errorf("decoding bookmark: %w", err)
			}

			path, isStale, err := ResolveBookmark(data)
			if err != nil {
				return "", err
			}

			if isStale {
				// Re-create bookmark with the resolved path
				_ = s.Save(key, path)
			}

			return path, nil
		}
	}

	return "", fmt.Errorf("no bookmark found for key %q", key)
}

func (s *BookmarkStore) loadEntries() ([]bookmarkEntry, error) {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return nil, err
	}
	var entries []bookmarkEntry
	if err := json.Unmarshal(data, &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

func (s *BookmarkStore) saveEntries(entries []bookmarkEntry) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(entries, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0644)
}
