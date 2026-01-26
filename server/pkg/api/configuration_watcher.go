package api

import (
	"log/slog"
	"os"
	"sync"
	"time"
)

// ConfigurationWatcher watches a configuration file for changes using polling.
type ConfigurationWatcher struct {
	path        string
	subscribers []func()
	mu          sync.RWMutex
	done        chan struct{}
}

// NewConfigurationWatcher creates a new configuration file watcher.
func NewConfigurationWatcher(path string) (*ConfigurationWatcher, error) {
	// Verify file exists
	if _, err := os.Stat(path); err != nil {
		return nil, err
	}

	cw := &ConfigurationWatcher{
		path: path,
		done: make(chan struct{}),
	}

	go cw.poll()

	return cw, nil
}

// Subscribe adds a callback that will be called when the configuration file changes.
// Returns an unsubscribe function.
func (cw *ConfigurationWatcher) Subscribe(callback func()) func() {
	cw.mu.Lock()
	cw.subscribers = append(cw.subscribers, callback)
	index := len(cw.subscribers) - 1
	cw.mu.Unlock()

	return func() {
		cw.mu.Lock()
		defer cw.mu.Unlock()
		if index < len(cw.subscribers) {
			cw.subscribers[index] = nil
		}
	}
}

func (cw *ConfigurationWatcher) poll() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	var lastModTime time.Time

	// Get initial mod time
	if info, err := os.Stat(cw.path); err == nil {
		lastModTime = info.ModTime()
	}

	for {
		select {
		case <-cw.done:
			return
		case <-ticker.C:
			info, err := os.Stat(cw.path)
			if err != nil {
				continue
			}

			modTime := info.ModTime()
			if !modTime.Equal(lastModTime) {
				slog.Debug("Configuration file changed", "path", cw.path)
				lastModTime = modTime
				cw.notify()
			}
		}
	}
}

func (cw *ConfigurationWatcher) notify() {
	cw.mu.RLock()
	subscribers := make([]func(), len(cw.subscribers))
	copy(subscribers, cw.subscribers)
	cw.mu.RUnlock()

	for _, callback := range subscribers {
		if callback != nil {
			callback()
		}
	}
}

// Close stops watching and releases resources.
func (cw *ConfigurationWatcher) Close() error {
	close(cw.done)
	return nil
}
