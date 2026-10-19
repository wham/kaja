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
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
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
	// maxIdleSessions is how many sessions with no window attached are kept beyond
	// the idle timeout's reach; past it the longest idle go first.
	maxIdleSessions = 64
	// maxSessions is the hard bound on sessions, attached ones included: a browser
	// offering itself past it is refused rather than let the registry grow without
	// end, since every session holds a catalog.
	maxSessions = 256
	// abortWait is how long a window is given to take an abort. Unlike the activity
	// chatter an abort is not something the next message says again, so it waits
	// rather than being dropped on a full buffer.
	abortWait = 2 * time.Second
	// runTimeout is the longest a run may take, matching the desktop's.
	runTimeout = 2 * time.Minute
	// streamBuffer is how many messages may be in flight to one window before the
	// server stops waiting for it.
	streamBuffer = 8
	// formTimeout is how long add_app waits for a person to finish the form it opened.
	// A form is a person at a keyboard rather than a server, so it is generous; the
	// agent's own timeout is what usually ends the wait first.
	formTimeout = 10 * time.Minute
	// compileWait is how long add_app waits for the window to report a freshly written
	// app as callable before answering without its services. A large OpenAPI document
	// takes a while to compile in the browser.
	compileWait = 45 * time.Second
	compilePoll = 250 * time.Millisecond
)

// The two ways a run has nowhere to happen. Both are answered to the agent as the
// tool failure they are, so it reads a sentence saying what to do rather than a timeout.
var (
	ErrNoWindow = errors.New("no Kaja window is attached to this agent session. " +
		"A script runs in a Kaja window, not in the process answering you — open Kaja, and in a browser connect the agent again")
	ErrWindowClosed = errors.New("the Kaja window was closed while the script was running, so the run was lost")
	// ErrTooManySessions is a browser offering itself to a server already holding as
	// many sessions as it will.
	ErrTooManySessions = errors.New("this Kaja is holding as many agent sessions as it can; try again later")
)

// Message is what the server sends down a window's stream.
type Message struct {
	// Type is "hello", "run", "abort", "activity", "duty", "scripts" or "form".
	Type string `json:"type"`
	// StreamID identifies this window to the server, on "hello".
	StreamID string `json:"streamId,omitempty"`
	// RunID correlates a "run" with the result the window posts back, and names the
	// run to drop on an "abort".
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
	// Progress is whether the agent asked to hear about this run while it is going, on
	// "run". A window beats only where somebody is listening, so a run nobody asked
	// about costs no traffic at all.
	Progress bool `json:"progress,omitempty"`
	// Link is the add-app link a "form" opens the New app form from, carrying the
	// request id the window answers under.
	Link string `json:"link,omitempty"`
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
	apps    Apps
	server  *mcp.Server

	mu        sync.Mutex
	streams   []*Stream
	catalog   mcp.Catalog
	pending   map[string]*pendingRun
	forms     map[string]chan mcp.AppFormOutcome
	idleSince time.Time
}

// pendingRun is a run dispatched to a window: where its answer goes, and what it says
// about itself on the way there. progress is nil where the agent asked for none.
type pendingRun struct {
	result   chan mcp.RunResult
	progress func(mcp.RunProgress)
}

// Handler is the MCP server bound to this session. One per session, so the in-flight
// count the sidebar's plug reads is this browser's own.
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

// sendWithin waits for the window to take the message, up to wait: an abort dropped
// on a full buffer is a script left running that nobody will come for.
func (s *Stream) sendWithin(message Message, wait time.Duration) bool {
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case s.messages <- message:
		return true
	case <-s.closed:
		return false
	case <-timer.C:
		return false
	}
}

// abort tells the window to drop a run, and says so in the log when the window did not
// take the message in time.
func (s *Stream) abort(runID string) {
	if !s.sendWithin(Message{Type: "abort", RunID: runID}, abortWait) {
		slog.Warn("The window did not take the abort", "runId", runID, "streamId", s.ID)
	}
}

// SetCatalog records what a window says is callable. Kept for as long as the session
// is, so discovery survives the window being closed.
func (s *Session) SetCatalog(catalog mcp.Catalog) {
	s.mu.Lock()
	s.catalog = catalog
	s.mu.Unlock()
}

// SetCatalogFrom is SetCatalog for a push that names the window it came from: only the
// window on duty is believed, so a tab that has just loaded and compiled half its apps
// cannot overwrite the full picture the window being looked at pushed. A window gaining
// duty is told so and pushes again. It reports whether the catalog was taken.
func (s *Session) SetCatalogFrom(streamID string, catalog mcp.Catalog) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	on := s.duty()
	if on == nil || on.ID != streamID {
		return false
	}
	s.catalog = catalog
	return true
}

// Result delivers a run's outcome from the window back to the waiting agent.
func (s *Session) Result(runID string, result mcp.RunResult) {
	s.mu.Lock()
	waiting := s.pending[runID]
	s.mu.Unlock()
	if waiting != nil {
		select {
		case waiting.result <- result:
		default:
		}
	}
}

// Progress carries what a window says about a run still going up to whoever is waiting
// on it. A run that has already been answered, or one nobody asked to hear about, is
// told nothing rather than reported on.
func (s *Session) Progress(runID string, progress mcp.RunProgress) {
	s.mu.Lock()
	waiting := s.pending[runID]
	s.mu.Unlock()
	if waiting == nil || waiting.progress == nil {
		return
	}
	waiting.progress(progress)
}

// Run sends a script to the window on duty and waits for what it produced. progress is
// nil where the agent asked to hear nothing before the answer, and the window is told
// as much, so it beats only for a run somebody is listening to.
func (s *Session) Run(ctx context.Context, path, code, client string, progress func(mcp.RunProgress)) (mcp.RunResult, error) {
	s.mu.Lock()
	stream := s.duty()
	if stream == nil {
		s.mu.Unlock()
		return mcp.RunResult{}, ErrNoWindow
	}
	runID := randomID()
	waiting := make(chan mcp.RunResult, 1)
	s.pending[runID] = &pendingRun{result: waiting, progress: progress}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.pending, runID)
		s.mu.Unlock()
	}()

	select {
	case stream.messages <- Message{Type: "run", RunID: runID, Path: path, Code: code, Client: client, Progress: progress != nil}:
	case <-stream.closed:
		return mcp.RunResult{}, ErrNoWindow
	case <-ctx.Done():
		return mcp.RunResult{}, ctx.Err()
	}

	// Giving up on the answer is not giving up on the run: it is going on in the
	// window, holding whatever it opened, and nobody is coming for what it produces.
	// So the window is told to drop it, which is the same abort Stop is.
	select {
	case result := <-waiting:
		return result, nil
	case <-stream.closed:
		return mcp.RunResult{}, ErrWindowClosed
	case <-ctx.Done():
		stream.abort(runID)
		return mcp.RunResult{}, ctx.Err()
	case <-time.After(runTimeout):
		stream.abort(runID)
		return mcp.RunResult{}, fmt.Errorf("the script did not finish within %s, so the run was stopped", runTimeout)
	}
}

// AskAppForm opens Kaja's New app form, prefilled with the draft, in the window on
// duty - the one being looked at - and waits for the person to save or close it.
// Nothing is written until they save.
func (s *Session) AskAppForm(ctx context.Context, draft mcp.AppDraft) (mcp.AppFormOutcome, error) {
	s.mu.Lock()
	stream := s.duty()
	if stream == nil {
		s.mu.Unlock()
		return mcp.AppFormOutcome{}, ErrNoWindow
	}
	id := randomID()
	result := make(chan mcp.AppFormOutcome, 1)
	s.forms[id] = result
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.forms, id)
		s.mu.Unlock()
	}()

	select {
	case stream.messages <- Message{Type: "form", Link: appFormLink(draft, id)}:
	case <-stream.closed:
		return mcp.AppFormOutcome{}, ErrNoWindow
	case <-ctx.Done():
		return mcp.AppFormOutcome{}, ctx.Err()
	}
	select {
	case outcome := <-result:
		return outcome, nil
	case <-stream.closed:
		return mcp.AppFormOutcome{}, errors.New("the Kaja window was closed before the form was saved, so no app was added")
	case <-ctx.Done():
		return mcp.AppFormOutcome{}, ctx.Err()
	case <-time.After(formTimeout):
		return mcp.AppFormOutcome{}, fmt.Errorf("nobody finished the form within %s", formTimeout)
	}
}

// AppFormResult delivers what the person did with a form from the window back to the
// waiting agent. A form is finished once, so a second answer is dropped.
func (s *Session) AppFormResult(requestID string, outcome mcp.AppFormOutcome) {
	s.mu.Lock()
	form := s.forms[requestID]
	s.mu.Unlock()
	if form != nil {
		select {
		case form <- outcome:
		default:
		}
	}
}

// AwaitApp waits for a window to push a catalog naming the app, which is the moment
// its methods are callable. Compiling is the window's, so this is a poll rather than a
// signal, and a slow compile is answered without the listing rather than waited out.
func (s *Session) AwaitApp(ctx context.Context, name string) bool {
	deadline := time.After(compileWait)
	for {
		s.mu.Lock()
		catalog := s.catalog
		s.mu.Unlock()
		for _, app := range catalog.Apps {
			if app.Name == name && len(app.Services) > 0 {
				return true
			}
		}
		select {
		case <-ctx.Done():
			return false
		case <-deadline:
			return false
		case <-time.After(compilePoll):
		}
	}
}

// secretParameters are the fields a prefilled form is not handed through its URL: a
// link is shown to the person, passed to a URL handler and kept in a client's log, and
// the specification keeps credentials out of one. A `${NAME}` is a reference rather
// than a value and travels.
var secretParameters = map[string]bool{"token": true, "password": true, "spec_header_value": true}

// appFormLink is the add-app link that opens Kaja's New app form prefilled. The verb
// is the host and the draft is the query, in kaja.json's own field names, with the
// request id the form answers under.
func appFormLink(draft mcp.AppDraft, requestID string) string {
	query := url.Values{}
	query.Set("type", draft.Type)
	query.Set("name", draft.Name)
	query.Set("request", requestID)
	for key, value := range draft.Parameters {
		if value == "" || (secretParameters[key] && !strings.HasPrefix(value, "${")) {
			continue
		}
		query.Set(key, value)
	}
	if len(draft.Headers) > 0 {
		headers, _ := json.Marshal(draft.Headers)
		query.Set("headers", string(headers))
	}
	return "kaja://add-app?" + query.Encode()
}

// Activity tells every window of this browser that an agent is being served, so
// the plug in the sidebar lights wherever you are looking.
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

// Delivery is how the MCP server answers a request that has nothing to say before its
// answer, which depends on what sits in front of it. A request that asked to hear about
// itself is streamed whatever the delivery, a notification having nowhere else to go.
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
	apps     Apps
	delivery Delivery
	version  string

	mu       sync.Mutex
	sessions map[string]*Session
}

// NewRegistry builds the registry. scripts and apps are how this process reads and
// writes the workspace's scripts folder and its kaja.json: it owns the disk, and the
// window is only ever asked to run source. version is the running kaja's own, which
// every session reports as its MCP server's.
func NewRegistry(scripts Scripts, apps Apps, delivery Delivery, version string) *Registry {
	return &Registry{scripts: scripts, apps: apps, delivery: delivery, version: version, sessions: map[string]*Session{}}
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
	if len(r.sessions) >= maxSessions {
		return nil, ErrTooManySessions
	}
	session := &Session{
		token:     token,
		scripts:   r.scripts,
		apps:      r.apps,
		pending:   map[string]*pendingRun{},
		forms:     map[string]chan mcp.AppFormOutcome{},
		idleSince: time.Now(),
	}
	// The bridge is bound to the session and the server to the bridge, so a request
	// carrying this token can only ever reach this browser.
	session.server = mcp.NewServer(&bridge{session: session}, token, r.version)
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
// longest idle of those when there are too many. Must be called with mu held.
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
	if len(r.sessions) <= maxIdleSessions {
		return
	}
	sort.Slice(idle, func(i, j int) bool { return idle[i].idleSince.Before(idle[j].idleSince) })
	for _, session := range idle {
		if len(r.sessions) <= maxIdleSessions {
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
