package api

import (
	"log/slog"
	"os"
	"sync"
	"time"
)

// WorkspaceWatcher watches a workspace file for changes using polling.
type WorkspaceWatcher struct {
	path        string
	subscribers map[int]func()
	nextID      int
	mu          sync.RWMutex
	done        chan struct{}
	closeOnce   sync.Once
}

// NewWorkspaceWatcher creates a new workspace file watcher. The file may not
// exist yet: a workspace gets its kaja.json on the first write, and that is a change.
func NewWorkspaceWatcher(path string) (*WorkspaceWatcher, error) {
	cw := &WorkspaceWatcher{
		path:        path,
		subscribers: map[int]func(){},
		done:        make(chan struct{}),
	}

	go cw.poll()

	return cw, nil
}

// Subscribe adds a callback that will be called when the workspace file changes.
// Returns an unsubscribe function.
func (cw *WorkspaceWatcher) Subscribe(callback func()) func() {
	cw.mu.Lock()
	id := cw.nextID
	cw.nextID++
	cw.subscribers[id] = callback
	cw.mu.Unlock()

	return func() {
		cw.mu.Lock()
		delete(cw.subscribers, id)
		cw.mu.Unlock()
	}
}

// Done closes when the watcher is closed, which a subscriber waiting on changes reads
// as the end of them.
func (cw *WorkspaceWatcher) Done() <-chan struct{} { return cw.done }

// fileState is what the poll compares between ticks. The size is there because a
// write that lands within the mtime's granularity, or a tool that preserves mtimes,
// moves nothing else.
type fileState struct {
	exists  bool
	modTime time.Time
	size    int64
}

func statFile(path string) fileState {
	info, err := os.Stat(path)
	if err != nil {
		return fileState{}
	}
	return fileState{exists: true, modTime: info.ModTime(), size: info.Size()}
}

func (cw *WorkspaceWatcher) poll() {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	last := statFile(cw.path)

	for {
		select {
		case <-cw.done:
			return
		case <-ticker.C:
			current := statFile(cw.path)
			if current != last {
				slog.Debug("Workspace file changed", "path", cw.path)
				last = current
				cw.notify()
			}
		}
	}
}

func (cw *WorkspaceWatcher) notify() {
	cw.mu.RLock()
	subscribers := make([]func(), 0, len(cw.subscribers))
	for _, callback := range cw.subscribers {
		subscribers = append(subscribers, callback)
	}
	cw.mu.RUnlock()

	for _, callback := range subscribers {
		callback()
	}
}

// Close stops watching and releases resources.
func (cw *WorkspaceWatcher) Close() error {
	cw.closeOnce.Do(func() { close(cw.done) })
	return nil
}
