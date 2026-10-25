package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"sync"
)

// ValuesHeader carries a browser's own values on every request it makes, and
// ValuesTrailer hands back what the call wrote to them. A served kaja keeps no value
// for anybody: the browser is the store, the process resolves against what each
// request brings and forgets it with the request.
//
// The header is base64 over JSON, because a header is Latin-1 and a value may not be.
const (
	ValuesHeader  = "X-Kaja-Values"
	ValuesTrailer = "kaja-values"
)

// BrowserValues is the store a request brought with it: the values one browser
// keeps for the workspace it has open, and what the call wrote to them since.
type BrowserValues struct {
	mu        sync.Mutex
	workspace string
	values    map[string]string
	// written is every name the call set or deleted, a nil value being a delete.
	written map[string]*string
}

type browserValuesJSON struct {
	Workspace string             `json:"workspace,omitempty"`
	Values    map[string]*string `json:"values,omitempty"`
}

// ReadBrowserValues reads the header. A request without one brings no store, and
// one that can't be read brings an empty store rather than failing the call: the
// browser said it keeps values, it just said nothing usable about which.
func ReadBrowserValues(header string) *BrowserValues {
	if header == "" {
		return nil
	}
	held := &BrowserValues{values: map[string]string{}, written: map[string]*string{}}
	payload, err := base64.StdEncoding.DecodeString(header)
	if err != nil {
		return held
	}
	var read browserValuesJSON
	if json.Unmarshal(payload, &read) != nil {
		return held
	}
	held.workspace = read.Workspace
	for name, value := range read.Values {
		if value != nil {
			held.values[name] = *value
		}
	}
	return held
}

func (b *BrowserValues) Available() bool { return true }

// Get answers only for the workspace the values were kept for: a browser holding
// the values of a workspace this process no longer serves has none for this one.
func (b *BrowserValues) Get(workspaceID string, name string) (string, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if workspaceID != b.workspace {
		return "", false
	}
	value, ok := b.values[name]
	return value, ok
}

func (b *BrowserValues) Set(workspaceID string, name string, value string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.adopt(workspaceID)
	b.values[name] = value
	b.written[name] = &value
	return nil
}

func (b *BrowserValues) Delete(workspaceID string, name string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.adopt(workspaceID)
	delete(b.values, name)
	b.written[name] = nil
	return nil
}

// adopt files the values under the workspace a write names, which is how the first
// value a browser keeps arrives: the workspace had no id until the write gave it one.
func (b *BrowserValues) adopt(workspaceID string) {
	if workspaceID == b.workspace {
		return
	}
	b.workspace = workspaceID
	b.values = map[string]string{}
}

// Written is the trailer's value: the workspace and every name the call wrote, or
// "" where it wrote nothing.
func (b *BrowserValues) Written() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.written) == 0 {
		return ""
	}
	payload, err := json.Marshal(browserValuesJSON{Workspace: b.workspace, Values: b.written})
	if err != nil {
		return ""
	}
	return string(payload)
}

type browserValuesKey struct{}

// WithBrowserValues hands the request's store to everything the call reaches.
func WithBrowserValues(ctx context.Context, values *BrowserValues) context.Context {
	return context.WithValue(ctx, browserValuesKey{}, values)
}

func browserValuesOf(ctx context.Context) *BrowserValues {
	if ctx == nil {
		return nil
	}
	values, _ := ctx.Value(browserValuesKey{}).(*BrowserValues)
	return values
}
