package main

import (
	"sync"
)

// keychainService is the service name every kaja item is filed under.
const keychainService = "kaja"

// probeAccount is an account no variable can be named (${NAME} rejects the
// colon), so probing for it only ever asks the keychain whether it is there to
// answer - it never collides with a stored value.
const probeAccount = "kaja:probe"

// keychainStore keeps a variable's value in the OS keychain, so kaja.json only
// has to name it. Items are keyed by the workspace's id, so two workspaces that
// both declare TOKEN keep their own value, and one workspace synced between two
// devices finds the same value on both.
type keychainStore struct {
	once      sync.Once
	available bool
}

// NewKeychainStore binds the OS keychain as the place variable values live.
func NewKeychainStore() *keychainStore {
	return &keychainStore{}
}

func keychainAccount(workspaceID string, name string) string {
	return workspaceID + "#" + name
}

// Available probes the keychain once. A machine whose keychain can't be reached
// - a Linux desktop with no Secret Service, or a macOS build without the
// entitlement the data protection keychain needs - reports false, and the UI
// asks for the value in the environment instead of offering to store it.
func (s *keychainStore) Available() bool {
	s.once.Do(func() {
		s.available = probeKeychain(probeAccount)
	})
	return s.available
}

func (s *keychainStore) Get(workspaceID string, name string) (string, bool) {
	return keychainGet(keychainAccount(workspaceID, name))
}

func (s *keychainStore) Set(workspaceID string, name string, value string) error {
	return keychainSet(keychainAccount(workspaceID, name), value)
}

func (s *keychainStore) Delete(workspaceID string, name string) error {
	return keychainDelete(keychainAccount(workspaceID, name))
}
