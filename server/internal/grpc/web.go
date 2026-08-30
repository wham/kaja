package grpc

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/wham/kaja/v2/pkg/apps"
)

// A trailer block is metadata about a response, not a place to put one, and nothing in
// it is a size kaja chose: a header set an upstream sent, a body it only truncated, and
// escapeTrailerValue can triple either on the way in. So the block is bounded, and a
// value that does not fit is dropped whole rather than cut - half a JSON object is
// worse than none, and the client already reads a missing trailer as one that never
// came. Kaja's own trailer is written first and, where the whole of it will not fit, is
// written again without the headers that merely describe the hop: the failure itself is
// the thing that has to get through.
const maxTrailerBytes = 64 << 10

// grpcWebResponse writes a gRPC-Web response: zero or more data frames, then the one
// trailer frame carrying grpc-status, grpc-message and whatever else this hop has to
// say. A stream is the general case and a unary call the one that stops after a
// message, which is why the frames are written as they are had rather than assembled.
//
// The frames are binary rather than base64, in both directions. A grpc-web-text body is
// one continuous base64 stream, so a frame whose bytes do not land on a group boundary
// holds its last two bytes back until something follows them - which on a stream is a
// message held until the next message. Going the other way it buys a third more bytes
// and nothing else.
type grpcWebResponse struct {
	w       http.ResponseWriter
	flusher http.Flusher
}

func newGRPCWebResponse(w http.ResponseWriter) *grpcWebResponse {
	w.Header().Set("Content-Type", "application/grpc-web+proto")
	// A stream that arrives in one piece at the end is not a stream, so ask any
	// reverse proxy in front of this one not to buffer it.
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, _ := w.(http.Flusher)
	return &grpcWebResponse{w: w, flusher: flusher}
}

// message writes one response message and pushes it out, because a message held back
// for company is the whole of what a stream is not.
func (r *grpcWebResponse) message(message []byte) {
	r.write(grpcWebFrame(0, message))
}

// end writes the trailer frame. A status is carried here rather than in the HTTP
// status because by the time a stream fails its response has long since started.
// upstream is kaja's own trailer, nil where the call had nothing to report; metadata is
// what a forwarded call's server answered with, under its own names.
func (r *grpcWebResponse) end(status int, grpcMessage string, upstream *apps.Upstream, metadata map[string]string) {
	var trailers strings.Builder
	// grpc-message is a sentence rather than a document, so it is cut to fit instead of
	// dropped: a truncated reason still reads as the reason.
	fmt.Fprintf(&trailers, "grpc-status: %d\r\ngrpc-message: %s\r\n", status, escapeTrailerValue(cut(grpcMessage, maxTrailerBytes/4)))

	write := func(name, value string) bool {
		line := name + ": " + escapeTrailerValue(value) + "\r\n"
		if trailers.Len()+len(line) > maxTrailerBytes {
			return false
		}
		trailers.WriteString(line)
		return true
	}
	if upstream != nil {
		if !write(UpstreamTrailer, upstream.JSON()) {
			write(UpstreamTrailer, upstream.WithoutHeaders().JSON())
		}
	}
	names := make([]string, 0, len(metadata))
	for name := range metadata {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		write(name, metadata[name])
	}

	r.write(grpcWebFrame(0x80, []byte(trailers.String())))
}

func (r *grpcWebResponse) write(frame []byte) {
	r.w.Write(frame)
	if r.flusher != nil {
		r.flusher.Flush()
	}
}

// grpcWebFrame prefixes a payload with its gRPC-Web frame header: a flag byte (0 for
// data, 0x80 for trailers) and the payload length as a big-endian uint32. Appended
// rather than sized up front, so the length arithmetic cannot be what goes wrong.
func grpcWebFrame(flag byte, payload []byte) []byte {
	frame := []byte{flag, 0, 0, 0, 0}
	binary.BigEndian.PutUint32(frame[1:5], uint32(len(payload)))
	return append(frame, payload...)
}

// cut bounds a string to n bytes without splitting the UTF-8 sequence at the end.
func cut(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

// escapeTrailerValue percent-encodes everything a gRPC-Web trailer line cannot
// carry verbatim. Trailers are a text block a client splits on CRLF and reads
// byte by byte as Latin-1, so a UTF-8 payload arrives mangled ("—" as "â€""),
// and a newline in a value would end the line early. Encoding the bytes outside
// printable ASCII - and "%" itself, so the escape is reversible - keeps ordinary
// JSON readable on the wire while surviving the trip intact. This is also what
// the gRPC-Web spec asks of grpc-message.
func escapeTrailerValue(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < 0x20 || c > 0x7e || c == '%' {
			fmt.Fprintf(&b, "%%%02X", c)
			continue
		}
		b.WriteByte(c)
	}
	return b.String()
}

// readGRPCWebMessage reads the one message a gRPC-Web request carries: the five-byte
// frame header - a flag byte, then the payload's length as a big-endian uint32 - and
// the payload behind it. Binary only, which is what kaja's client sends. No call kaja
// serves streams from the client, so the frame after this one, if a client sent one, is
// nobody's to read.
//
// The payload is copied rather than allocated up front, because the length is the
// client's to write and nothing has to make it good: a header claiming four gigabytes
// would otherwise be four gigabytes asked of this process before a byte of it arrives.
func readGRPCWebMessage(r io.Reader) ([]byte, error) {
	header := make([]byte, 5)
	if _, err := io.ReadFull(r, header); err != nil {
		return nil, fmt.Errorf("reading frame header: %w", err)
	}

	var message bytes.Buffer
	if _, err := io.CopyN(&message, r, int64(binary.BigEndian.Uint32(header[1:5]))); err != nil {
		return nil, fmt.Errorf("reading frame payload: %w", err)
	}
	return message.Bytes(), nil
}
