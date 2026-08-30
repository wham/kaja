package grpc

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/wham/kaja/v2/pkg/apps"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// requestFrame builds the gRPC-Web request body carrying msg, which is the message
// behind its frame header and nothing else: kaja speaks the binary format in both
// directions.
func requestFrame(msg []byte) []byte {
	frame := make([]byte, 5+len(msg))
	binary.BigEndian.PutUint32(frame[1:5], uint32(len(msg)))
	copy(frame[5:], msg)
	return frame
}

// parseGRPCWebFrames splits a gRPC-Web response body into its data messages and the
// text of its trailer frame.
func parseGRPCWebFrames(t *testing.T, body []byte) (messages [][]byte, trailers string) {
	t.Helper()
	for len(body) >= 5 {
		flag := body[0]
		n := binary.BigEndian.Uint32(body[1:5])
		if uint32(len(body)-5) < n {
			t.Fatalf("frame says %d bytes, %d left", n, len(body)-5)
		}
		payload := body[5 : 5+n]
		if flag&0x80 != 0 {
			trailers = string(payload)
		} else {
			messages = append(messages, payload)
		}
		body = body[5+n:]
	}
	return messages, trailers
}

// parseGRPCWebResponse reads a response that carries at most one message, which is
// every response an app that transcodes answers with.
func parseGRPCWebResponse(t *testing.T, body []byte) (message []byte, trailers string) {
	t.Helper()
	messages, trailers := parseGRPCWebFrames(t, body)
	if len(messages) > 1 {
		t.Fatalf("got %d messages, want at most one", len(messages))
	}
	if len(messages) == 1 {
		message = messages[0]
	}
	return message, trailers
}

// serveMessage answers one request carrying message, which is every request the lane
// takes: no call kaja serves streams from the client.
func serveMessage(method string, message []byte, invoke Invoker) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/app/"+method, bytes.NewReader(requestFrame(message)))
	r.Header.Set("Content-Type", "application/grpc-web+proto")
	w := httptest.NewRecorder()
	Serve(w, r, method, nil, invoke)
	return w
}

// answers is the invoker of an app that answers with one message and a report.
func answers(body []byte, report *apps.Report) Invoker {
	return func(context.Context, string, []byte, map[string]string) (apps.Stream, error) {
		return apps.OneMessage(body, report), nil
	}
}

// fails is the invoker of a call that never produced a stream.
func fails(err error) Invoker {
	return func(context.Context, string, []byte, map[string]string) (apps.Stream, error) {
		return nil, err
	}
}

// upstreamTrailer reads Kaja's own trailer back as the object it is.
func upstreamTrailer(t *testing.T, trailers string) map[string]any {
	t.Helper()
	envelope := map[string]any{}
	if err := json.Unmarshal([]byte(trailerValue(t, trailers, UpstreamTrailer)), &envelope); err != nil {
		t.Fatalf("upstream trailer: %v\ntrailers = %q", err, trailers)
	}
	return envelope
}

func TestServeSuccess(t *testing.T) {
	var gotMethod string
	var gotMessage []byte
	w := serveMessage("svc/Method", []byte{1, 2, 3}, func(_ context.Context, method string, message []byte, _ map[string]string) (apps.Stream, error) {
		gotMethod = method
		gotMessage = message
		return apps.OneMessage([]byte{9, 8, 7}, &apps.Report{}), nil
	})

	if gotMethod != "svc/Method" {
		t.Errorf("method = %q, want svc/Method", gotMethod)
	}
	if string(gotMessage) != string([]byte{1, 2, 3}) {
		t.Errorf("de-framed message = %v, want [1 2 3]", gotMessage)
	}

	message, trailers := parseGRPCWebResponse(t, w.Body.Bytes())
	if string(message) != string([]byte{9, 8, 7}) {
		t.Errorf("response message = %v, want [9 8 7]", message)
	}
	if !strings.Contains(trailers, "grpc-status: 0") {
		t.Errorf("trailers = %q, want grpc-status: 0", trailers)
	}
}

// A body that ends inside its frame is refused rather than invoked with whatever
// arrived: a message the frame header says is longer than the body is not the request
// anyone made.
func TestServeRefusesATruncatedFrame(t *testing.T) {
	frame := requestFrame([]byte{1, 2, 3})
	r := httptest.NewRequest(http.MethodPost, "/app/svc/Method", bytes.NewReader(frame[:len(frame)-1]))
	w := httptest.NewRecorder()

	invoked := false
	Serve(w, r, "svc/Method", nil, func(context.Context, string, []byte, map[string]string) (apps.Stream, error) {
		invoked = true
		return apps.OneMessage(nil, nil), nil
	})

	if invoked {
		t.Error("the call was invoked on a message that never fully arrived")
	}
	if w.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

// A call with nothing to report - the internal Api service, which forwards nothing -
// writes no trailer of Kaja's at all, rather than an empty one saying so.
func TestServeReportsNothingWhenThereIsNoHop(t *testing.T) {
	w := serveMessage("GetConfiguration", []byte("request"), answers([]byte("response"), nil))

	message, trailers := parseGRPCWebResponse(t, w.Body.Bytes())
	if string(message) != "response" {
		t.Errorf("message = %q", message)
	}
	if strings.Contains(trailers, UpstreamTrailer) {
		t.Errorf("trailers = %q, want no upstream trailer", trailers)
	}
}

// The whole of what Kaja has to say about a call rides one trailer: the hop it made,
// what that hop took, and - on a failure - the failure itself.
func TestServeReportsTheHopInOneTrailer(t *testing.T) {
	w := serveMessage("svc/Method", []byte{1}, answers([]byte{9}, &apps.Report{
		RequestHeaders:  map[string]string{"Authorization": "Bearer secret"},
		ResponseHeaders: map[string]string{"Content-Type": "application/json"},
		DurationMs:      42,
	}))

	_, trailers := parseGRPCWebResponse(t, w.Body.Bytes())
	envelope := upstreamTrailer(t, trailers)
	if envelope["durationMs"] != float64(42) {
		t.Errorf("durationMs = %v, want 42", envelope["durationMs"])
	}
	request, _ := envelope["requestHeaders"].(map[string]any)
	if request["Authorization"] != "Bearer secret" {
		t.Errorf("requestHeaders = %#v", envelope["requestHeaders"])
	}
	response, _ := envelope["responseHeaders"].(map[string]any)
	if response["Content-Type"] != "application/json" {
		t.Errorf("responseHeaders = %#v", envelope["responseHeaders"])
	}
}

// A plain Go error is UNKNOWN, and one carrying a status keeps the code it named -
// which is what an in-process service's own failure reaches the browser as.
func TestServeError(t *testing.T) {
	for _, test := range []struct {
		err  error
		want string
	}{
		{errors.New("failed to save configuration"), "grpc-status: 2"},
		{status.Error(codes.InvalidArgument, "failed to save configuration"), "grpc-status: 3"},
	} {
		w := serveMessage("UpdateConfiguration", nil, fails(test.err))

		message, trailers := parseGRPCWebResponse(t, w.Body.Bytes())
		if message != nil {
			t.Errorf("got a message on a failure: %q", message)
		}
		if !strings.Contains(trailers, test.want) {
			t.Errorf("trailers %q, want %q", trailers, test.want)
		}
		if !strings.Contains(trailers, "grpc-message: failed to save configuration") {
			t.Errorf("trailers %q", trailers)
		}
	}
}

// A newline in a message is escaped rather than dropped, so it cannot end the trailer
// line early and the message still reads as it was written once decoded.
func TestServeErrorMessageSurvivesANewline(t *testing.T) {
	w := serveMessage("svc/Method", []byte{1}, fails(fmt.Errorf("upstream 404\nnot found")))

	_, trailers := parseGRPCWebResponse(t, w.Body.Bytes())
	if got := trailerValue(t, trailers, "grpc-message"); got != "upstream 404\nnot found" {
		t.Errorf("grpc-message = %q, want the message round-tripped intact", got)
	}
	if strings.Count(trailers, "\n") != 2 {
		t.Errorf("grpc-message newline not escaped: %q", trailers)
	}
}

// TestServeUpstreamError locks in that an apps.UpstreamError maps to the matching gRPC
// status and that the failure itself - the status, message, request line and body the
// client shows instead of the gRPC error - rides whole in Kaja's own trailer.
func TestServeUpstreamError(t *testing.T) {
	body := `{"title":"Bad Request","detail":"request body has an error"}`
	w := serveMessage("svc/Method", []byte{1}, fails(
		apps.NewUpstreamError(http.MethodPost, "https://api.example.com/v1/events", http.StatusBadRequest, []byte(body)).
			WithHeaders(map[string]string{"Authorization": "Bearer secret"}, map[string]string{"Content-Type": "application/json"})))

	message, trailers := parseGRPCWebResponse(t, w.Body.Bytes())
	if message != nil {
		t.Errorf("expected no data frame on error, got %v", message)
	}
	if !strings.Contains(trailers, "grpc-status: 3") {
		t.Errorf("trailers = %q, want grpc-status: 3 (INVALID_ARGUMENT)", trailers)
	}

	envelope := upstreamTrailer(t, trailers)
	failure, _ := envelope["error"].(map[string]any)
	if failure["status"] != float64(400) || failure["statusText"] != "Bad Request" {
		t.Errorf("upstream error status = %v/%v, want 400/Bad Request", failure["status"], failure["statusText"])
	}
	if failure["message"] != "request body has an error" {
		t.Errorf("upstream error message = %v", failure["message"])
	}
	if failure["request"] != "POST https://api.example.com/v1/events" {
		t.Errorf("upstream error request = %v", failure["request"])
	}
	// The body stays JSON rather than a string of JSON, so the console shows it
	// as a value instead of an escaped blob.
	if nested, ok := failure["body"].(map[string]any); !ok || nested["title"] != "Bad Request" {
		t.Errorf("upstream error body = %#v, want the parsed problem document", failure["body"])
	}

	// The exchanged headers ride along on the error too (a 401/4xx is exactly
	// when they matter).
	request, _ := envelope["requestHeaders"].(map[string]any)
	if request["Authorization"] != "Bearer secret" {
		t.Errorf("requestHeaders = %#v, want the headers the failed hop was made with", envelope["requestHeaders"])
	}
}

// TestTrailerValuesSurviveNonASCII locks in that a value with characters outside
// printable ASCII reaches the client intact. gRPC-Web trailers are a text block
// clients read byte by byte as Latin-1, so an unescaped em dash arrives as
// "â€"" — which is what used to show up in the console.
func TestTrailerValuesSurviveNonASCII(t *testing.T) {
	const detail = `no show "glass-mountainz" — list them all`
	w := serveMessage("svc/Method", []byte{1}, fails(
		apps.NewUpstreamError(http.MethodGet, "https://api.example.com/shows/x", http.StatusNotFound,
			[]byte(`{"detail":`+strconv.Quote(detail)+`}`))))

	_, trailers := parseGRPCWebResponse(t, w.Body.Bytes())
	for _, line := range strings.Split(trailers, "\r\n") {
		for i := 0; i < len(line); i++ {
			if line[i] > 0x7e {
				t.Fatalf("trailer line is not ASCII: %q", line)
			}
		}
	}

	failure, _ := upstreamTrailer(t, trailers)["error"].(map[string]any)
	if failure["message"] != detail {
		t.Errorf("message = %q, want %q", failure["message"], detail)
	}
}

// trailerValue reads one trailer by name, undoing the percent-escaping the
// client undoes with decodeURIComponent.
func trailerValue(t *testing.T, trailers string, name string) string {
	t.Helper()
	for _, line := range strings.Split(trailers, "\r\n") {
		key, value, found := strings.Cut(line, ": ")
		if !found || key != name {
			continue
		}
		decoded, err := url.QueryUnescape(value)
		if err != nil {
			t.Fatalf("trailer %q is not valid percent-encoding: %v", name, err)
		}
		return decoded
	}
	t.Fatalf("trailer %q missing from %q", name, trailers)
	return ""
}

func TestGRPCStatusFromHTTP(t *testing.T) {
	tests := map[int]int{400: 3, 401: 16, 403: 7, 404: 5, 409: 10, 429: 8, 418: 2, 500: 13, 501: 12, 502: 13, 503: 14, 504: 4}
	for httpStatus, want := range tests {
		if got := grpcStatusFromHTTP(httpStatus); got != want {
			t.Errorf("grpcStatusFromHTTP(%d) = %d, want %d", httpStatus, got, want)
		}
	}
}

// TestGRPCStatusOf locks in that the status an upstream gRPC server answered with
// survives the client's error wrapping, so the browser is shown NOT_FOUND from the
// API rather than a 500 from this process.
func TestGRPCStatusOf(t *testing.T) {
	wrapped := fmt.Errorf("gRPC invocation failed: %w", status.Error(codes.NotFound, "no such show"))
	code, message := grpcStatusOf(wrapped)
	if code != int(codes.NotFound) || message != "no such show" {
		t.Errorf("grpcStatusOf(wrapped) = %d %q, want %d %q", code, message, codes.NotFound, "no such show")
	}

	// An error with no status never left this process, which is what UNKNOWN says.
	code, message = grpcStatusOf(errors.New("dial tcp: connection refused"))
	if code != 2 || message != "dial tcp: connection refused" {
		t.Errorf("grpcStatusOf(plain) = %d %q, want 2 and the message intact", code, message)
	}
}

// TestTrailerBlockIsBounded locks in that nothing an upstream sends can decide how big
// the trailer block gets - and that what is given up under pressure is the headers
// describing the hop, never the failure itself.
func TestTrailerBlockIsBounded(t *testing.T) {
	huge := strings.Repeat("x", 4*maxTrailerBytes)
	w := serveMessage("svc/Method", []byte{1}, fails(
		apps.NewUpstreamError(http.MethodGet, "https://api.example.com/x", http.StatusBadGateway, []byte(`{"detail":"gone"}`)).
			WithHeaders(map[string]string{"X-Huge": huge}, map[string]string{"X-Also-Huge": huge})))

	_, trailers := parseGRPCWebResponse(t, w.Body.Bytes())
	if len(trailers) > maxTrailerBytes {
		t.Errorf("trailer block is %d bytes, want at most %d", len(trailers), maxTrailerBytes)
	}
	if !strings.Contains(trailers, "grpc-status: 13") {
		t.Errorf("trailers = %q, want the status to survive", trailers[:200])
	}
	envelope := upstreamTrailer(t, trailers)
	failure, _ := envelope["error"].(map[string]any)
	if failure["message"] != "gone" {
		t.Errorf("upstream error message = %v", failure["message"])
	}
	if _, ok := envelope["requestHeaders"]; ok {
		t.Errorf("the headers that would not fit should be given up, not the report")
	}
	if strings.Contains(trailers, "X-Also-Huge") {
		t.Errorf("a header set that could not fit should be dropped whole")
	}
}

// A dropped trailer is dropped whole: a value cut in half would reach the client as
// JSON it cannot parse, which is worse than the trailer never arriving.
func TestOversizedTrailerIsDroppedNotCut(t *testing.T) {
	w := serveMessage("svc/Method", []byte{1}, answers([]byte{9}, &apps.Report{
		Metadata: map[string]string{"x-huge": strings.Repeat("y", 4*maxTrailerBytes)},
	}))

	message, trailers := parseGRPCWebResponse(t, w.Body.Bytes())
	if string(message) != string([]byte{9}) {
		t.Errorf("the response itself must be unaffected, got %v", message)
	}
	for _, line := range strings.Split(trailers, "\r\n") {
		if line == "" {
			continue
		}
		if _, _, found := strings.Cut(line, ": "); !found {
			t.Errorf("trailer line is not whole: %q", line)
		}
	}
	if strings.Contains(trailers, "x-huge") {
		t.Errorf("trailers = %q, want the oversized one dropped", trailers)
	}
}

// grpc-message is cut before it is escaped, and escaping can triple what it is given,
// so the cut has to leave room for that.
func TestLongGRPCMessageFitsOnceEscaped(t *testing.T) {
	w := serveMessage("svc/Method", []byte{1}, fails(fmt.Errorf("%s", strings.Repeat("→", 4*maxTrailerBytes))))

	_, trailers := parseGRPCWebResponse(t, w.Body.Bytes())
	if len(trailers) > maxTrailerBytes {
		t.Errorf("trailer block is %d bytes, want at most %d", len(trailers), maxTrailerBytes)
	}
	if !utf8.ValidString(trailerValue(t, trailers, "grpc-message")) {
		t.Error("the truncated message is not valid UTF-8")
	}
}

func TestCutKeepsRunesWhole(t *testing.T) {
	if got := cut("hello", 10); got != "hello" {
		t.Errorf("cut under the limit = %q", got)
	}
	// "é" is two bytes: cutting at 2 must not leave half of it behind.
	if got := cut("aé", 2); got != "a" {
		t.Errorf("cut = %q, want the partial rune dropped", got)
	}
	if !utf8.ValidString(cut(strings.Repeat("→", 100), 55)) {
		t.Error("cut produced invalid UTF-8")
	}
}
