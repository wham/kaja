package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// TokenStore is where what an authorization flow produced is kept: the token a
// resource is called with, and the client an authorization server knows kaja as.
//
// It is deliberately not kaja.json. The configuration file names a workspace's
// apps and is meant to be committed, so the one thing it may never hold is a
// credential nobody typed into it - and a token that refreshes itself is not
// something a person could keep in a file of theirs anyway. So it lives beside
// the other state this installation holds, readable by its owner and nobody
// else.
type TokenStore struct {
	path string
	mu   sync.Mutex
}

// grant is everything one resource's token needs to be used and renewed: the
// authorization server that issued it, and the token itself.
type grant struct {
	Server *authorizationServer `json:"server"`
	Token  *tokenSet            `json:"token"`
}

type storeFile struct {
	// Grants are keyed by the canonical resource URI, which is what a token is
	// issued for and what it may be sent to.
	Grants map[string]*grant `json:"grants,omitempty"`
	// Clients are keyed by the authorization server's issuer, because a client id
	// belongs to the server that issued it and to no other.
	Clients map[string]*registration `json:"clients,omitempty"`
}

// NewTokenStore opens the store at an explicit path.
func NewTokenStore(path string) *TokenStore { return &TokenStore{path: path} }

// DefaultTokenStore is the store this installation keeps, under the directory the
// platform gives a program for its own state. On a sandboxed desktop build that
// is the app's container, which is the same place its log and its configuration
// already live.
func DefaultTokenStore() (*TokenStore, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return nil, fmt.Errorf("finding where to keep the authorization: %w", err)
	}
	return NewTokenStore(filepath.Join(dir, "kaja", "mcp-oauth.json")), nil
}

func (s *TokenStore) read() *storeFile {
	file := &storeFile{}
	payload, err := os.ReadFile(s.path)
	if err != nil || json.Unmarshal(payload, file) != nil {
		return &storeFile{}
	}
	return file
}

func (s *TokenStore) write(file *storeFile) error {
	payload, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(s.path, payload, 0o600)
}

// Grant is what is held for one resource, or nothing.
func (s *TokenStore) Grant(resource string) *grant {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read().Grants[resource]
}

// SaveGrant records a resource's token and the server that issued it.
func (s *TokenStore) SaveGrant(resource string, held *grant) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	file := s.read()
	if file.Grants == nil {
		file.Grants = map[string]*grant{}
	}
	file.Grants[resource] = held
	return s.write(file)
}

// Forget drops a resource's token. The client kaja registered stays: it is the
// authorization server's record of this installation, not of this sign-in, and
// re-registering on every sign-out leaves a trail of clients behind.
func (s *TokenStore) Forget(resource string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	file := s.read()
	if _, held := file.Grants[resource]; !held {
		return nil
	}
	delete(file.Grants, resource)
	return s.write(file)
}

// Client is the client an authorization server already knows kaja as.
func (s *TokenStore) Client(issuer string) *registration {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read().Clients[issuer]
}

// SaveClient records a registration against the issuer that made it, which is
// the only server it means anything to.
func (s *TokenStore) SaveClient(issuer string, registered *registration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	file := s.read()
	if file.Clients == nil {
		file.Clients = map[string]*registration{}
	}
	file.Clients[issuer] = registered
	return s.write(file)
}
