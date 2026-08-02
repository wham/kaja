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
// has to name it. Items are keyed by the configuration they belong to, so two
// workspaces that both declare TOKEN keep their own value.
type keychainStore struct {
	configurationPath string

	once      sync.Once
	available bool
}

// NewKeychainStore binds the OS keychain as the place variable values live.
func NewKeychainStore(configurationPath string) *keychainStore {
	return &keychainStore{configurationPath: configurationPath}
}

func (s *keychainStore) account(name string) string {
	return s.configurationPath + "#" + name
}

// Available probes the keychain once. A machine whose keychain can't be reached
// - a Linux desktop with no Secret Service, or a macOS build without the
// entitlement the data protection keychain needs - reports false, and the UI
// asks for the value in the environment instead of offering to store it.
func (s *keychainStore) Available() bool {
	s.once.Do(func() {
		s.available = probeKeychain(s.account(probeAccount))
	})
	return s.available
}

func (s *keychainStore) Get(name string) (string, bool) {
	return keychainGet(s.account(name))
}

func (s *keychainStore) Set(name string, value string) error {
	return keychainSet(s.account(name), value)
}

func (s *keychainStore) Delete(name string) error {
	return keychainDelete(s.account(name))
}
