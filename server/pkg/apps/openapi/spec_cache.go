package openapi

import (
	"container/list"
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/wham/kaja/v2/pkg/apps"
)

// specCacheSize bounds how many parsed documents the process keeps. A large API's
// document is megabytes once parsed, and a workspace has a handful of them.
const specCacheSize = 8

// fetchedSpec is a document read off a URL, kept so the form reading it and the
// compile that follows a save are one fetch rather than two. Nothing writes to a
// parsed spec, so one can be handed to every app opened from it.
type fetchedSpec struct {
	spec   *spec
	readAt time.Time
}

type specCache struct {
	mu      sync.Mutex
	entries map[specKey]*list.Element
	order   *list.List
}

type specCacheEntry struct {
	key     specKey
	fetched *fetchedSpec
}

var specs = &specCache{entries: map[specKey]*list.Element{}, order: list.New()}

func (c *specCache) get(key specKey) (*fetchedSpec, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	element, ok := c.entries[key]
	if !ok {
		return nil, false
	}
	c.order.MoveToFront(element)
	return element.Value.(*specCacheEntry).fetched, true
}

func (c *specCache) put(key specKey, fetched *fetchedSpec) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if element, ok := c.entries[key]; ok {
		c.order.Remove(element)
	}
	c.entries[key] = c.order.PushFront(&specCacheEntry{key: key, fetched: fetched})
	for c.order.Len() > specCacheSize {
		oldest := c.order.Back()
		c.order.Remove(oldest)
		delete(c.entries, oldest.Value.(*specCacheEntry).key)
	}
}

// specKey is what a fetch depends on: the URL and every credential it was sent with,
// since a document behind a login can differ per token.
type specKey struct {
	url         string
	credentials fetchCredentials
}

// fetchSpec is loadSpec behind the process's cache. Only a document that was read is
// kept, so a failure is asked again on the next try; a fresh context reads the URL
// again and replaces what was kept.
func fetchSpec(ctx context.Context, specURL string, credentials fetchCredentials, log func(string)) (*fetchedSpec, *problem) {
	key := specKey{url: specURL, credentials: credentials}
	if !apps.Fresh(ctx) {
		if fetched, ok := specs.get(key); ok {
			log(fmt.Sprintf("Reused the OpenAPI spec read %s ago; recompile to read it again", time.Since(fetched.readAt).Round(time.Second)))
			return fetched, nil
		}
	}
	log("Fetching OpenAPI spec from " + specURL)
	s, p := loadSpec(ctx, specURL, credentials, log)
	if p != nil {
		return nil, p
	}
	fetched := &fetchedSpec{spec: s, readAt: time.Now()}
	specs.put(key, fetched)
	return fetched, nil
}
