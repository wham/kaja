package grpcapptest

import (
	"fmt"
	"strings"
	"testing"

	"google.golang.org/protobuf/reflect/protoreflect"
)

// The fidelity surface is what a size test is written against: one method taking and
// answering the same message, with a string and a bytes field in it.
const (
	getTicket = "fidelity.v1.Tickets/GetTicket"
	ticket    = "fidelity.v1.Ticket"
)

// openTickets starts that upstream and a kaja pointed at it.
func openTickets(t *testing.T, options upstreamOptions) (*upstream, *kaja) {
	t.Helper()
	options.Dirs = []string{"fidelity"}
	up := startUpstream(t, options)
	k := openKaja(t, "tickets", map[string]string{"url": up.URL, "proto_dir": absolute(t, "testdata/fidelity")}, nil)
	k.files = up.Files
	return up, k
}

// TestInvokeBigResponse is an API answering with more than a few megabytes, which a
// listing endpoint does as soon as the page size is generous. How big a response is,
// is the API's business - kaja may not be the one refusing it.
func TestInvokeBigResponse(t *testing.T) {
	for _, size := range []int{1 << 20, 4 << 20, 16 << 20} {
		t.Run(fmt.Sprintf("%dMB", size>>20), func(t *testing.T) {
			up, k := openTickets(t, upstreamOptions{MaxSendBytes: 64 << 20, Behave: func(c *call) error {
				response := c.New()
				response.Set(response.Descriptor().Fields().ByName("id"), protoreflect.ValueOfString(strings.Repeat("x", size)))
				return c.Send(response)
			}})

			e := k.invoke(t, getTicket, build(t, up.Files, ticket, nil), nil)

			code, message := e.grpcStatus(t)
			if code != "0" {
				t.Fatalf("a %dMB response came back as %s: %s", size>>20, code, message)
			}
			answered := decode(t, up.Files, ticket, e.Messages[0])
			if got := len(answered.Get(answered.Descriptor().Fields().ByName("id")).String()); got != size {
				t.Errorf("the response is %d bytes, want %d", got, size)
			}
		})
	}
}

// TestInvokeBigRequest is the same the other way round: a script sending a payload.
func TestInvokeBigRequest(t *testing.T) {
	const size = 8 << 20
	var seen int
	up, k := openTickets(t, upstreamOptions{MaxRecvBytes: 64 << 20, Behave: func(c *call) error {
		seen = len(c.Request.Get(c.Request.Descriptor().Fields().ByName("signature")).Bytes())
		return c.Send(c.New())
	}})

	request := build(t, up.Files, ticket, map[string]any{"signature": []byte(strings.Repeat("y", size))})
	e := k.invoke(t, getTicket, request, nil)

	if code, message := e.grpcStatus(t); code != "0" {
		t.Fatalf("an %dMB request came back as %s: %s", size>>20, code, message)
	}
	if seen != size {
		t.Errorf("the server read %d bytes, want %d", seen, size)
	}
}

// TestInvokeCompressedResponse is a server that compresses what it sends, which is
// what a server does as soon as its responses are worth compressing.
func TestInvokeCompressedResponse(t *testing.T) {
	const text = "compress me "
	up, k := openTickets(t, upstreamOptions{Behave: func(c *call) error {
		response := c.New()
		response.Set(response.Descriptor().Fields().ByName("id"), protoreflect.ValueOfString(strings.Repeat(text, 1000)))
		// Named rather than imported: registering the compressor is what kaja's own
		// build has to do, so a test that imported it would be testing itself.
		return c.SendCompressed(response, "gzip")
	}})

	e := k.invoke(t, getTicket, build(t, up.Files, ticket, nil), nil)

	code, message := e.grpcStatus(t)
	if code != "0" {
		t.Fatalf("a compressed response came back as %s: %s", code, message)
	}
	answered := decode(t, up.Files, ticket, e.Messages[0])
	if got := answered.Get(answered.Descriptor().Fields().ByName("id")).String(); len(got) != len(text)*1000 {
		t.Errorf("the response is %d bytes, want the %d that were compressed", len(got), len(text)*1000)
	}
}
