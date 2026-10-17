package grpc

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"
)

// A frame header is the client's to write, so a length past what kaja accepts is
// refused before a byte of the payload is read rather than copied until the client
// stops sending.
func TestReadGRPCWebMessageRefusesAnOversizedFrame(t *testing.T) {
	header := make([]byte, 5)
	binary.BigEndian.PutUint32(header[1:], uint32(MaxRequestMessage+1))
	_, err := readGRPCWebMessage(bytes.NewReader(append(header, make([]byte, 16)...)))
	if err == nil || !strings.Contains(err.Error(), "more than") {
		t.Fatalf("err = %v, want the frame refused for its size", err)
	}

	small := []byte{0, 0, 0, 0, 3, 1, 2, 3}
	message, err := readGRPCWebMessage(bytes.NewReader(small))
	if err != nil || !bytes.Equal(message, []byte{1, 2, 3}) {
		t.Fatalf("message = %v, %v, want the payload", message, err)
	}
}
