// Package agent is the switchboard between kaja's MCP server (pkg/mcp) and the window
// that can answer it. No process running this can run a script itself — the script
// runtime, the `kaja` object and the service clients are JavaScript in a webview — so
// every run_script goes down a window's stream and its answer comes back up.
//
// Both builds are that one switchboard. A deployed kaja holds a session per browser,
// each with the windows that browser has open; the desktop is the degenerate case of
// the same design — one session, on the token the process persists, with one window
// permanently attached over the mux its webview already fetches its calls on. What
// differs between them is Scripts, because the desktop owns the workspace it opened
// and a server serves one it does not.
//
// On the web a session is something a browser offers, not something the server has.
// The tab makes up a token, keeps it in its own storage, and holds an open stream
// under it. The token is the address of a browser rather than a key to the server:
// it opens nothing while no tab is listening, nothing here is written to disk, and a
// token that has never been attached with is unknown. The desktop's token is the one
// it persists so the connection command stays valid across restarts, which is why it
// opens its session rather than waiting to be offered one.
package agent

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wham/kaja/v2/pkg/mcp"
)

const (
	// sessionIdle is how long a session outlives its last window. It is what lets
	// discovery keep working across a reload; only run_script needs a live window.
	sessionIdle = 30 * time.Minute
	// maxSessions bounds what one server holds. Only sessions with no window attached
	// are ever let go.
	maxSessions = 64
	// runTimeout is the longest a run may take, matching the desktop's.
	runTimeout = 2 * time.Minute
	// streamBuffer is how many messages may be in flight to one window before the
	// server stops waiting for it.
	streamBuffer = 8
)

// The two ways a run has nowhere to happen. Both are answered to the agent as the
// tool failure they are, so it reads a sentence saying what to do rather than a timeout.
var (
	ErrNoWindow = errors.New("no Kaja window is attached to this agent session. " +
		"A script runs in a Kaja window, not in the process answering you — open Kaja, and in a browser connect the agent again")
	ErrWindowClosed = errors.New("the Kaja window was closed while the script was running, so the run was lost")
)

// Message is what the server sends down a window's stream.
type Message struct {
	// Type is "hello", "run", "activity" or "duty".
	Type string `json:"type"`
	// StreamID identifies this window to the server, on "hello".
	StreamID string `json:"streamId,omitempty"`
	// RunID correlates a "run" with the result the window posts back.
	RunID string `json:"runId,omitempty"`
	// Path is the saved script being run, empty for an inline snippet. Code is always
	// set: the server owns the disk, so it reads the file itself and the window is only
	// ever asked to run source.
	Path string `json:"path,omitempty"`
	Code string `json:"code,omitempty"`
	// Client is what the agent calls itself, which labels the draft an inline snippet
	// runs in.
	Client string `json:"client,omitempty"`
	// InFlight is how many agent requests are being served, on "activity".
	InFlight int `json:"inFlight"`
	// OnDuty is whether this window is the one runs are sent to, on "duty".
	OnDuty bool `json:"onDuty"`
	// Change is what an agent did to a file on disk, on "scripts".
	Change *ScriptChange `json:"change,omitempty"`
}

// Stream is one attached window.
type Stream struct {
	ID       string
	session  *Session
	messages chan Message
	closed   chan struct{}
	once     sync.Once

	// Guarded by session.mu.
	focusedAt time.Time
}

// Messages is what the HTTP handler writes down to the browser.
func (s *Stream) Messages() <-chan Message { return s.messages }

// Closed fires when the window goes away, which fails a run dispatched to it rather
// than leaving the agent to wait out the timeout.
func (s *Stream) Closed() <-chan struct{} { return s.closed }

// Detach removes the window from its session.
func (s *Stream) Detach() {
	s.once.Do(func() {
		close(s.closed)
		s.session.remove(s)
	})
}

// Session is one browser: the windows it has open, the catalog they pushed, and
// the runs waiting on them.
type Session struct {
	token   string
	scripts Scripts
	server  *mcp.Server

	mu        sync.Mutex
	streams   []*Stream
	catalog   mcp.Catalog
	pending   map[string]chan mcp.RunResult
	idleSince time.Time
}

// Handler is the MCP server bound to this session. One per session, so the in-flight
// count the footer's plug reads is this browser's own.
func (s *Session) Handler() *mcp.Server { return s.server }

// Attached is whether any window is listening.
func (s *Session) Attached() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.streams) > 0
}

// attach adds a window and makes it the one on duty: a window that just opened is
// the one you are looking at.
func (s *Session) attach() *Stream {
	stream := &Stream{
		ID:        randomID(),
		session:   s,
		messages:  make(chan Message, streamBuffer),
		closed:    make(chan struct{}),
		focusedAt: time.Now(),
	}
	s.mu.Lock()
	s.streams = append(s.streams, stream)
	s.idleSince = time.Time{}
	s.mu.Unlock()

	stream.messages <- Message{Type: "hello", StreamID: stream.ID}
	s.publishDuty()
	return stream
}

func (s *Session) remove(stream *Stream) {
	s.mu.Lock()
	kept := s.streams[:0]
	for _, existing := range s.streams {
		if existing != stream {
			kept = append(kept, existing)
		}
	}
	s.streams = kept
	if len(s.streams) == 0 {
		s.idleSince = time.Now()
	}
	s.mu.Unlock()
	s.publishDuty()
}

// Focus marks a window as the one being looked at. The most recently focused window
// is the one a run is sent to: the run's console is in memory in the window that ran
// it, so a run landing in the wrong window is one you cannot watch.
func (s *Session) Focus(streamID string) {
	s.mu.Lock()
	for _, stream := range s.streams {
		if stream.ID == streamID {
			stream.focusedAt = time.Now()
		}
	}
	s.mu.Unlock()
	s.publishDuty()
}

// duty is the window a run goes to. Must be called with mu held.
func (s *Session) duty() *Stream {
	var on *Stream
	for _, stream := range s.streams {
		if on == nil || stream.focusedAt.After(on.focusedAt) {
			on = stream
		}
	}
	return on
}

// publishDuty tells every window whether it is the one on duty, so two windows never
// both claim the agent.
func (s *Session) publishDuty() {
	s.mu.Lock()
	on := s.duty()
	messages := make([]struct {
		stream *Stream
		on     bool
	}, 0, len(s.streams))
	for _, stream := range s.streams {
		messages = append(messages, struct {
			stream *Stream
			on     bool
		}{stream, stream == on})
	}
	s.mu.Unlock()
	for _, m := range messages {
		m.stream.send(Message{Type: "duty", OnDuty: m.on})
	}
}

// send never blocks: a window that is not reading is a window that is going away,
// and the run waiting on it fails on its own closed channel.
func (s *Stream) send(message Message) {
	select {
	case s.messages <- message:
	case <-s.closed:
	default:
	}
}

// SetCatalog records what a window says is callable. Kept for as long as the session
// is, so discovery survives the window being closed.
func (s *Session) SetCatalog(catalog mcp.Catalog) {
	s.mu.Lock()
	s.catalog = catalog
	s.mu.Unlock()
}

// Result delivers a run's outcome from the window back to the waiting agent.
func (s *Session) Result(runID string, result mcp.RunResult) {
	s.mu.Lock()
	waiting := s.pending[runID]
	s.mu.Unlock()
	if waiting != nil {
		select {
		case waiting <- result:
		default:
		}
	}
}

// Run sends a script to the window on duty and waits for what it produced.
func (s *Session) Run(ctx context.Context, path, code, client string) (mcp.RunResult, error) {
	s.mu.Lock()
	stream := s.duty()
	if stream == nil {
		s.mu.Unlock()
		return mcp.RunResult{}, ErrNoWindow
	}
	runID := randomID()
	waiting := make(chan mcp.RunResult, 1)
	s.pending[runID] = waiting
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.pending, runID)
		s.mu.Unlock()
	}()

	select {
	case stream.messages <- Message{Type: "run", RunID: runID, Path: path, Code: code, Client: client}:
	case <-stream.closed:
		return mcp.RunResult{}, ErrNoWindow
	case <-ctx.Done():
		return mcp.RunResult{}, ctx.Err()
	}

	select {
	case result := <-waiting:
		return result, nil
	case <-stream.closed:
		return mcp.RunResult{}, ErrWindowClosed
	case <-ctx.Done():
		return mcp.RunResult{}, ctx.Err()
	case <-time.After(runTimeout):
		return mcp.RunResult{}, fmt.Errorf("the script did not finish within %s", runTimeout)
	}
}

// Activity tells every window of this browser that an agent is being served, so
// the plug in the footer lights wherever you are looking.
func (s *Session) Activity(inFlight int) {
	s.broadcast(Message{Type: "activity", InFlight: inFlight})
}

// ScriptChanged tells every window what an agent did to a file, so the sidebar and an
// open editor stay in step with a write nobody in the window made.
func (s *Session) ScriptChanged(change ScriptChange) {
	s.broadcast(Message{Type: "scripts", Change: &change})
}

func (s *Session) broadcast(message Message) {
	s.mu.Lock()
	streams := append([]*Stream(nil), s.streams...)
	s.mu.Unlock()
	for _, stream := range streams {
		stream.send(message)
	}
}

// Delivery is how the MCP server answers, which depends on what sits in front of it.
type Delivery int

const (
	// Direct answers with a single JSON body. Nothing sits between an agent and the
	// desktop, so there is no idle connection anyone has to be reassured about.
	Direct Delivery = iota
	// Streamed offers SSE whenever the client takes one, so a minute-long run is not a
	// request that has carried no bytes for a minute past whatever proxy is in front.
	Streamed
)

// Registry is every browser this process has seen. The desktop's holds exactly one.
type Registry struct {
	scripts  Scripts
	delivery Delivery

	mu       sync.Mutex
	sessions map[string]*Session
}

// NewRegistry builds the registry. scripts is how this process reads and writes the
// workspace's scripts folder: it owns the disk, and the window is only ever asked to
// run source.
func NewRegistry(scripts Scripts, delivery Delivery) *Registry {
	return &Registry{scripts: scripts, delivery: delivery, sessions: map[string]*Session{}}
}

// Open makes a session without a window attached. It is what the desktop does with the
// token it persists: an agent may be pointed at that token before the window has
// offered itself, and a 401 there would say the token was wrong rather than that the
// window was not up yet. Nothing on the web calls it — there a session is something a
// browser offers.
func (r *Registry) Open(token string) (*Session, error) {
	if err := ValidateToken(token); err != nil {
		return nil, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sweep()
	if session := r.sessions[token]; session != nil {
		return session, nil
	}
	session := &Session{
		token:     token,
		scripts:   r.scripts,
		pending:   map[string]chan mcp.RunResult{},
		idleSince: time.Now(),
	}
	// The bridge is bound to the session and the server to the bridge, so a request
	// carrying this token can only ever reach this browser.
	session.server = mcp.NewServer(&bridge{session: session}, token)
	if r.delivery == Streamed {
		session.server = session.server.Streamed()
	}
	r.sessions[token] = session
	return session, nil
}

// Attach opens a window's stream, creating the session if this is the first one.
func (r *Registry) Attach(token string) (*Stream, error) {
	session, err := r.Open(token)
	if err != nil {
		return nil, err
	}
	return session.attach(), nil
}

// Session returns an existing session. A token nobody has attached with is unknown,
// which is what makes the browser's own storage the only place a session comes from.
func (r *Registry) Session(token string) (*Session, bool) {
	if ValidateToken(token) != nil {
		return nil, false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sweep()
	session, ok := r.sessions[token]
	return session, ok
}

// Drop forgets a browser. Disconnecting must not wait on the idle timeout: the
// session goes now, and with it the catalog that would otherwise go on answering.
func (r *Registry) Drop(token string) {
	r.mu.Lock()
	delete(r.sessions, token)
	r.mu.Unlock()
}

// sweep drops sessions no window has been attached to for a while, and trims the
// oldest of those when there are too many. Must be called with mu held.
func (r *Registry) sweep() {
	idle := make([]*Session, 0, len(r.sessions))
	for token, session := range r.sessions {
		session.mu.Lock()
		attached := len(session.streams) > 0
		since := session.idleSince
		session.mu.Unlock()
		if attached {
			continue
		}
		if time.Since(since) > sessionIdle {
			delete(r.sessions, token)
			continue
		}
		idle = append(idle, session)
	}
	if len(r.sessions) <= maxSessions {
		return
	}
	sort.Slice(idle, func(i, j int) bool { return idle[i].idleSince.Before(idle[j].idleSince) })
	for _, session := range idle {
		if len(r.sessions) <= maxSessions {
			return
		}
		delete(r.sessions, session.token)
	}
}

// ValidateToken checks the shape of a token. The browser makes one up, so this only
// stops a typo or an empty string from becoming a session.
func ValidateToken(token string) error {
	if len(token) < 24 || len(token) > 128 {
		return errors.New("an agent session token is between 24 and 128 characters")
	}
	for _, r := range token {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
		default:
			return errors.New("an agent session token holds only letters, digits, - and _")
		}
	}
	return nil
}

// BearerToken pulls the token out of the Authorization header.
func BearerToken(header string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(header, prefix))
}

func randomID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(b)
}
