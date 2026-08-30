package agent

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/wham/kaja/v2/pkg/mcp"
)

const (
	// streamPing keeps the window's stream from looking idle to whatever sits
	// between the browser and this server.
	streamPing = 20 * time.Second
	// maxCatalog is generous because a catalog carries the declarations of every
	// type a script can name, which on a large API is most of a megabyte.
	maxCatalog = 32 << 20
	maxResult  = 8 << 20
	maxBody    = 1 << 16
)

// Mount registers the doors a window offers itself at and the one an agent is pointed
// at. Both builds mount the same set on the mux their UI is served from: the desktop's
// window attaches over the mux its webview already fetches its calls on, and its
// loopback listener puts ServeMCP in front of this same switchboard because an agent
// is a different process.
func Mount(mux *http.ServeMux, registry *Registry) {
	mux.HandleFunc("GET /agent-session", registry.ServeInfo)
	mux.HandleFunc("POST /agent-session/attach", registry.ServeAttach)
	mux.HandleFunc("POST /agent-session/detach", registry.ServeDetach)
	mux.HandleFunc("POST /agent-session/focus", registry.ServeFocus)
	mux.HandleFunc("POST /agent-session/catalog", registry.ServeCatalog)
	mux.HandleFunc("POST /agent-session/result", registry.ServeResult)
	mux.HandleFunc("POST /mcp", registry.ServeMCP)
}

// ServeInfo says that this server opens the door at all, which is what decides
// whether the footer offers to connect an agent. It is deliberately the only one
// of these endpoints that answers without a token: there is nothing behind it.
func (r *Registry) ServeInfo(w http.ResponseWriter, req *http.Request) {
	writeJSON(w, map[string]any{"available": true})
}

// ServeAttach is a window offering itself. The response is a stream of NDJSON
// messages held open for as long as the window is, and it is the only way a
// session ever comes into being.
func (r *Registry) ServeAttach(w http.ResponseWriter, req *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}
	stream, err := r.Attach(BearerToken(req.Header.Get("Authorization")))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	defer stream.Detach()

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache")
	// Ask any reverse proxy not to buffer: a stream that arrives in one piece at
	// the end is not a stream.
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	encoder := json.NewEncoder(w)
	ping := time.NewTicker(streamPing)
	defer ping.Stop()
	for {
		select {
		case <-req.Context().Done():
			return
		case <-ping.C:
			if encoder.Encode(Message{Type: "ping"}) != nil {
				return
			}
			flusher.Flush()
		case message := <-stream.Messages():
			if encoder.Encode(message) != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// ServeDetach is a browser saying it is done. The session goes at once rather
// than on the idle timeout, which is what makes Disconnect mean what the footer
// says it means: the token names nothing from here on.
func (r *Registry) ServeDetach(w http.ResponseWriter, req *http.Request) {
	if _, ok := r.authorize(w, req); !ok {
		return
	}
	r.Drop(BearerToken(req.Header.Get("Authorization")))
	w.WriteHeader(http.StatusNoContent)
}

// ServeFocus marks the window a run should be sent to.
func (r *Registry) ServeFocus(w http.ResponseWriter, req *http.Request) {
	session, ok := r.authorize(w, req)
	if !ok {
		return
	}
	var body struct {
		StreamID string `json:"streamId"`
	}
	if !decode(w, req, maxBody, &body) {
		return
	}
	session.Focus(body.StreamID)
	w.WriteHeader(http.StatusNoContent)
}

// ServeCatalog takes the services picture from the window. The body is the
// catalog itself.
func (r *Registry) ServeCatalog(w http.ResponseWriter, req *http.Request) {
	session, ok := r.authorize(w, req)
	if !ok {
		return
	}
	var catalog mcp.Catalog
	if !decode(w, req, maxCatalog, &catalog) {
		return
	}
	session.SetCatalog(catalog)
	w.WriteHeader(http.StatusNoContent)
}

// ServeResult takes a run's outcome back from the window.
func (r *Registry) ServeResult(w http.ResponseWriter, req *http.Request) {
	session, ok := r.authorize(w, req)
	if !ok {
		return
	}
	var body struct {
		RunID  string        `json:"runId"`
		Result mcp.RunResult `json:"result"`
	}
	if !decode(w, req, maxResult, &body) {
		return
	}
	session.Result(body.RunID, body.Result)
	w.WriteHeader(http.StatusNoContent)
}

// ServeMCP is the endpoint an agent is pointed at. The token names the browser,
// so an agent reaches the one it was given and no other; a token no window has
// attached with is unknown, which is what makes a session something a browser
// offers rather than something this server hands out.
func (r *Registry) ServeMCP(w http.ResponseWriter, req *http.Request) {
	session, ok := r.authorize(w, req)
	if !ok {
		return
	}
	session.Handler().ServeHTTP(w, req)
}

func (r *Registry) authorize(w http.ResponseWriter, req *http.Request) (*Session, bool) {
	session, ok := r.Session(BearerToken(req.Header.Get("Authorization")))
	if !ok {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return nil, false
	}
	return session, true
}

func decode(w http.ResponseWriter, req *http.Request, limit int64, into any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, req.Body, limit)).Decode(into); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(value)
}
