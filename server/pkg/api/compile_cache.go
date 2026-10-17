package api

import (
	"container/list"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/wham/kaja/v2/pkg/apps"
)

// compileCacheSize bounds how many compiled surfaces the process keeps. A workspace
// has a handful of apps; the bound is for a session that opens many workspaces.
const compileCacheSize = 64

// compiledApp is one surface the process has compiled: the instance that answers its
// calls and the manifest the window builds its types from. Credentials are read off
// the call rather than held by the instance, which is what makes one safe to hand to
// a second compile of the same app.
type compiledApp struct {
	opened   *apps.Opened
	manifest string
}

// compileCache keeps compiled surfaces by what they were compiled from, most recently
// used first, and closes what it lets go of.
type compileCache struct {
	mu      sync.Mutex
	entries map[string]*list.Element
	order   *list.List
}

type cacheEntry struct {
	key      string
	compiled *compiledApp
}

func newCompileCache() *compileCache {
	return &compileCache{entries: map[string]*list.Element{}, order: list.New()}
}

func (c *compileCache) get(key string) (*compiledApp, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	element, ok := c.entries[key]
	if !ok {
		return nil, false
	}
	c.order.MoveToFront(element)
	return element.Value.(*cacheEntry).compiled, true
}

// put records a compiled surface under key, replacing what was there and letting the
// least recently used one go when the cache is full. What leaves the cache may still
// be registered under an app's name, which is why Close only releases what an instance
// holds between calls.
func (c *compileCache) put(key string, compiled *compiledApp) {
	var released []*compiledApp
	c.mu.Lock()
	if element, ok := c.entries[key]; ok {
		if previous := element.Value.(*cacheEntry).compiled; previous.opened.Instance != compiled.opened.Instance {
			released = append(released, previous)
		}
		c.order.Remove(element)
		delete(c.entries, key)
	}
	c.entries[key] = c.order.PushFront(&cacheEntry{key: key, compiled: compiled})
	for c.order.Len() > compileCacheSize {
		oldest := c.order.Back()
		entry := oldest.Value.(*cacheEntry)
		c.order.Remove(oldest)
		delete(c.entries, entry.key)
		released = append(released, entry.compiled)
	}
	c.mu.Unlock()
	for _, compiled := range released {
		apps.CloseInstance(compiled.opened.Instance)
	}
}

// compileKey is what a surface is compiled from: the app's type, every expanded
// parameter, and for a surface read off the disk the proto files themselves, so an
// edited .proto is a different key rather than a stale hit.
func compileKey(appType string, parameters map[string]string) string {
	digest := sha256.New()
	digest.Write([]byte(appType))
	keys := make([]string, 0, len(parameters))
	for key := range parameters {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		digest.Write([]byte{0})
		digest.Write([]byte(key))
		digest.Write([]byte{'='})
		digest.Write([]byte(parameters[key]))
	}
	if dir := protoDirOnDisk(appType, parameters); dir != "" {
		digest.Write([]byte{0})
		hashProtoFiles(digest, dir)
	}
	return hex.EncodeToString(digest.Sum(nil))
}

// protoDirOnDisk is the folder of .proto files an app is compiled from, for the app
// types that have one.
func protoDirOnDisk(appType string, parameters map[string]string) string {
	switch appType {
	case "twirp":
		return strings.TrimSpace(parameters["proto_dir"])
	case "grpc":
		if strings.TrimSpace(parameters["reflection"]) != "true" {
			return strings.TrimSpace(parameters["proto_dir"])
		}
	}
	return ""
}

// needsSourcesDir says whether an app writes a proto surface of its own: everything
// but a surface already on disk.
func needsSourcesDir(appType string, parameters map[string]string) bool {
	return protoDirOnDisk(appType, parameters) == ""
}

func hashProtoFiles(digest io.Writer, dir string) {
	files, err := findProtoFiles(dir)
	if err != nil {
		io.WriteString(digest, err.Error())
		return
	}
	sort.Strings(files)
	for _, file := range files {
		io.WriteString(digest, file)
		digest.Write([]byte{0})
		content, err := os.ReadFile(filepath.Join(dir, file))
		if err != nil {
			io.WriteString(digest, err.Error())
		} else {
			digest.Write(content)
		}
		digest.Write([]byte{0})
	}
}
