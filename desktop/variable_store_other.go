//go:build !darwin

package main

// Windows and Linux reach their keyring through a library: it talks to the
// Credential Manager and the Secret Service directly, so there is no CLI to
// spawn and nothing the darwin file's Security framework code would buy here.

import (
	"errors"
	"log/slog"

	"github.com/zalando/go-keyring"
)

func keychainGet(account string) (string, bool) {
	value, err := keyring.Get(keychainService, account)
	if err != nil {
		if !errors.Is(err, keyring.ErrNotFound) {
			slog.Warn("Failed to read a stored variable value", "error", err)
		}
		return "", false
	}
	return value, true
}

func keychainSet(account string, value string) error {
	return keyring.Set(keychainService, account, value)
}

func keychainDelete(account string) error {
	if err := keyring.Delete(keychainService, account); err != nil && !errors.Is(err, keyring.ErrNotFound) {
		return err
	}
	return nil
}

// probeKeychain asks for an item that isn't there. Being told so is the
// successful outcome: the keyring answered. Anything else - a Linux desktop with
// no Secret Service running - means there is nothing to store values in.
func probeKeychain(account string) bool {
	_, err := keyring.Get(keychainService, account)
	available := err == nil || errors.Is(err, keyring.ErrNotFound)
	if !available {
		slog.Warn("No usable keyring; ${secret} variables will only resolve from the environment", "error", err)
	}
	return available
}
