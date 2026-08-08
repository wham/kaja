package grpc

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/url"
	"os"
	"strings"

	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

// TLS modes. An empty mode leaves the decision to the target URL, which is what
// kaja did before an app could say.
const (
	TLSOn  = "on"
	TLSOff = "off"
)

// TLSOptions is everything about a connection the target URL can't say: whether
// to speak TLS at all, and which certificates to trust and to present. The zero
// value reads the mode off the URL and verifies against the system roots, so a
// caller with nothing to configure passes it and behaves as kaja always has.
type TLSOptions struct {
	// Mode is TLSOn, TLSOff, or empty to decide from the target URL.
	Mode string
	// SkipVerify accepts whatever certificate the server presents.
	SkipVerify bool
	// CAFile, CertFile and KeyFile are absolute paths to PEM files: the roots the
	// server is verified against, and the client certificate kaja presents.
	CAFile   string
	CertFile string
	KeyFile  string
}

// UseTLS reports whether the connection to target speaks TLS.
func (o TLSOptions) UseTLS(target *url.URL) bool {
	switch o.Mode {
	case TLSOn:
		return true
	case TLSOff:
		return false
	}
	return ShouldUseTLS(target)
}

// WithMode returns the options with the mode settled, which is how a caller that
// has just discovered whether a server speaks TLS records the answer.
func (o TLSOptions) WithMode(mode string) TLSOptions {
	o.Mode = mode
	return o
}

// credentials builds the transport credentials for a connection. useTLS is the
// decision already made, so a caller that tried both ways can ask for the one
// that answered.
func (o TLSOptions) credentials(useTLS bool) (credentials.TransportCredentials, error) {
	if !useTLS {
		return insecure.NewCredentials(), nil
	}

	configuration := &tls.Config{InsecureSkipVerify: o.SkipVerify}

	if o.CAFile != "" {
		pem, err := os.ReadFile(o.CAFile)
		if err != nil {
			return nil, fmt.Errorf("reading certificate authority %s: %w", o.CAFile, err)
		}
		roots := x509.NewCertPool()
		if !roots.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("certificate authority %s holds no certificates", o.CAFile)
		}
		configuration.RootCAs = roots
	}

	if o.CertFile != "" || o.KeyFile != "" {
		if o.CertFile == "" || o.KeyFile == "" {
			return nil, fmt.Errorf("a client certificate needs both the certificate and the key")
		}
		certificate, err := tls.LoadX509KeyPair(o.CertFile, o.KeyFile)
		if err != nil {
			return nil, fmt.Errorf("reading client certificate: %w", err)
		}
		configuration.Certificates = []tls.Certificate{certificate}
	}

	return credentials.NewTLS(configuration), nil
}

// key fingerprints the options so the connection cache keeps one connection per
// distinct way of connecting rather than per target.
func (o TLSOptions) key() string {
	return strings.Join([]string{fmt.Sprint(o.SkipVerify), o.CAFile, o.CertFile, o.KeyFile}, "\x00")
}
