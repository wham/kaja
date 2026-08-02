package main

import (
	"errors"
	"log/slog"
	"sync"

	"github.com/zalando/go-keyring"
)

// keychainService is the service name every kaja item is filed under in the OS
// keychain.
const keychainService = "kaja"

// keychainStore keeps a variable's value in the OS keychain, so kaja.json only
// has to name it. Items are keyed by the configuration they belong to, so two
// workspaces that both declare TOKEN keep their own value, and the account name
// stays readable in Keychain Access.
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

// Available probes the keychain once. A machine without a usable keyring (a
// Linux desktop with no Secret Service running) reports false, and the UI asks
// for the value in the environment instead of offering to store it.
func (s *keychainStore) Available() bool {
	s.once.Do(func() {
		_, err := keyring.Get(keychainService, s.account("\x00probe"))
		// Not finding the probe item is the successful outcome: the keyring
		// answered. Anything else means there is nothing to talk to.
		s.available = err == nil || errors.Is(err, keyring.ErrNotFound)
		if !s.available {
			slog.Warn("No usable keyring; ${secret} variables will only resolve from the environment", "error", err)
		}
	})
	return s.available
}

func (s *keychainStore) Get(name string) (string, bool) {
	value, err := keyring.Get(keychainService, s.account(name))
	if err != nil {
		if !errors.Is(err, keyring.ErrNotFound) {
			slog.Warn("Failed to read a stored variable value", "name", name, "error", err)
		}
		return "", false
	}
	return value, true
}

func (s *keychainStore) Set(name string, value string) error {
	return keyring.Set(keychainService, s.account(name), value)
}

func (s *keychainStore) Delete(name string) error {
	if err := keyring.Delete(keychainService, s.account(name)); err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return err
	}
	return nil
}
