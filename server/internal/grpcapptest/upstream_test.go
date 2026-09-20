// Package deeptest drives the whole gRPC app lane against real servers: an upstream
// built from well-known .proto specs, and the public ones kaja's own demo points at.
package grpcapptest

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wham/protoc-go/protoc"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/reflection"
	v1reflectiongrpc "google.golang.org/grpc/reflection/grpc_reflection_v1"
	v1alphareflectiongrpc "google.golang.org/grpc/reflection/grpc_reflection_v1alpha"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
	"google.golang.org/protobuf/types/descriptorpb"
	"google.golang.org/protobuf/types/dynamicpb"
)

// call is one invocation as the upstream saw it, and what it is to answer with.
type call struct {
	Method   string
	Request  *dynamicpb.Message
	Metadata metadata.MD
	// Send emits one response message; the handler may call it more than once.
	Send func(proto.Message) error
	// SendCompressed emits one response message compressed the way the named
	// compressor compresses it.
	SendCompressed func(proto.Message, string) error
	// New mints an empty response message of the method's output type.
	New func() *dynamicpb.Message
	// SetHeader / SetTrailer put metadata on the response.
	SetHeader  func(metadata.MD) error
	SetTrailer func(metadata.MD)
	// Recv reads the next client message on a client-streaming method.
	Recv func() (*dynamicpb.Message, error)
}

// behavior answers a call. Returning an error fails it with that status.
type behavior func(c *call) error

// upstream is a gRPC server whose surface is compiled from .proto files on disk and
// whose behaviour is a function, so a test says what a method does rather than
// generating a server for it.
type upstream struct {
	Address    string // host:port
	URL        string // the address as an app's "url" parameter
	Files      *protoregistry.Files
	CAFile     string
	ClientCert string
	ClientKey  string
	server     *grpc.Server
}

type upstreamOptions struct {
	// Dir is the proto directory, relative to testdata.
	Dirs []string
	// Reflection registers the reflection service (v1 and v1alpha).
	Reflection bool
	// ReflectionV1AlphaOnly registers only the older reflection service.
	ReflectionV1AlphaOnly bool
	// TLS serves over TLS with a certificate for 127.0.0.1.
	TLS bool
	// MutualTLS additionally requires a client certificate.
	MutualTLS bool
	// Auth, when set, is the metadata every call (reflection included) must carry.
	Auth func(md metadata.MD) error
	// Behave answers every call.
	Behave behavior
	// SourceInfo keeps the comments in the descriptors the server serves, which is
	// what a server built to document itself over reflection does.
	SourceInfo bool
	// MaxSendBytes and MaxRecvBytes raise the server's own message limits, so a test
	// about kaja's is about kaja's.
	MaxSendBytes int
	MaxRecvBytes int
}

func startUpstream(t *testing.T, options upstreamOptions) *upstream {
	t.Helper()

	files := compileFilesWith(t, options.SourceInfo, options.Dirs...)
	up := &upstream{Files: files}

	var serverOptions []grpc.ServerOption
	if options.TLS {
		up.CAFile, up.ClientCert, up.ClientKey = writeCerts(t)
		creds := serverCredentials(t, up.CAFile, options.MutualTLS)
		serverOptions = append(serverOptions, grpc.Creds(creds))
	}
	if options.Auth != nil {
		auth := options.Auth
		serverOptions = append(serverOptions,
			grpc.UnaryInterceptor(func(ctx context.Context, req any, _ *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
				md, _ := metadata.FromIncomingContext(ctx)
				if err := auth(md); err != nil {
					return nil, err
				}
				return handler(ctx, req)
			}),
			grpc.StreamInterceptor(func(srv any, ss grpc.ServerStream, _ *grpc.StreamServerInfo, handler grpc.StreamHandler) error {
				md, _ := metadata.FromIncomingContext(ss.Context())
				if err := auth(md); err != nil {
					return err
				}
				return handler(srv, ss)
			}),
		)
	}

	if options.MaxSendBytes > 0 {
		serverOptions = append(serverOptions, grpc.MaxSendMsgSize(options.MaxSendBytes))
	}
	if options.MaxRecvBytes > 0 {
		serverOptions = append(serverOptions, grpc.MaxRecvMsgSize(options.MaxRecvBytes))
	}

	server := grpc.NewServer(serverOptions...)
	up.server = server

	behave := options.Behave
	if behave == nil {
		behave = echoBehavior
	}
	registerDynamic(t, server, files, behave)

	if options.Reflection || options.ReflectionV1AlphaOnly {
		reflectionOptions := reflection.ServerOptions{Services: server, DescriptorResolver: files, ExtensionResolver: protoregistry.GlobalTypes}
		v1alphareflectiongrpc.RegisterServerReflectionServer(server, reflection.NewServer(reflectionOptions))
		if !options.ReflectionV1AlphaOnly {
			v1reflectiongrpc.RegisterServerReflectionServer(server, reflection.NewServerV1(reflectionOptions))
		}
	}

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	up.Address = listener.Addr().String()
	if options.TLS {
		up.URL = "https://" + up.Address
	} else {
		up.URL = "http://" + up.Address
	}

	go server.Serve(listener)
	t.Cleanup(server.Stop)
	return up
}

// echoBehavior answers every method with one zero-valued response message.
func echoBehavior(c *call) error { return c.Send(c.New()) }

// registerDynamic registers every service in files, dispatching each method to behave.
func registerDynamic(t *testing.T, server *grpc.Server, files *protoregistry.Files, behave behavior) {
	t.Helper()
	files.RangeFiles(func(file protoreflect.FileDescriptor) bool {
		for i := 0; i < file.Services().Len(); i++ {
			service := file.Services().Get(i)
			desc := &grpc.ServiceDesc{ServiceName: string(service.FullName()), HandlerType: (*any)(nil)}
			for j := 0; j < service.Methods().Len(); j++ {
				method := service.Methods().Get(j)
				name := string(method.Name())
				full := "/" + string(service.FullName()) + "/" + name
				input, output := method.Input(), method.Output()

				if method.IsStreamingClient() || method.IsStreamingServer() {
					desc.Streams = append(desc.Streams, grpc.StreamDesc{
						StreamName:    name,
						ClientStreams: method.IsStreamingClient(),
						ServerStreams: method.IsStreamingServer(),
						Handler: func(_ any, stream grpc.ServerStream) error {
							request := dynamicpb.NewMessage(input)
							if !method.IsStreamingClient() {
								if err := stream.RecvMsg(request); err != nil {
									return err
								}
							}
							return behave(&call{
								Method:   full,
								Request:  request,
								Metadata: incoming(stream.Context()),
								Send:     func(m proto.Message) error { return stream.SendMsg(m) },
								SendCompressed: func(m proto.Message, compressor string) error {
									if err := grpc.SetSendCompressor(stream.Context(), compressor); err != nil {
										return err
									}
									return stream.SendMsg(m)
								},
								New:        func() *dynamicpb.Message { return dynamicpb.NewMessage(output) },
								SetHeader:  stream.SetHeader,
								SetTrailer: stream.SetTrailer,
								Recv: func() (*dynamicpb.Message, error) {
									next := dynamicpb.NewMessage(input)
									return next, stream.RecvMsg(next)
								},
							})
						},
					})
					continue
				}

				desc.Methods = append(desc.Methods, grpc.MethodDesc{
					MethodName: name,
					Handler: func(_ any, ctx context.Context, dec func(any) error, _ grpc.UnaryServerInterceptor) (any, error) {
						request := dynamicpb.NewMessage(input)
						if err := dec(request); err != nil {
							return nil, err
						}
						var response proto.Message
						err := behave(&call{
							Method:   full,
							Request:  request,
							Metadata: incoming(ctx),
							Send:     func(m proto.Message) error { response = m; return nil },
							SendCompressed: func(m proto.Message, compressor string) error {
								if err := grpc.SetSendCompressor(ctx, compressor); err != nil {
									return err
								}
								response = m
								return nil
							},
							New:        func() *dynamicpb.Message { return dynamicpb.NewMessage(output) },
							SetHeader:  func(md metadata.MD) error { return grpc.SetHeader(ctx, md) },
							SetTrailer: func(md metadata.MD) { grpc.SetTrailer(ctx, md) },
							Recv:       func() (*dynamicpb.Message, error) { return nil, fmt.Errorf("not a client-streaming method") },
						})
						if err != nil {
							return nil, err
						}
						if response == nil {
							response = dynamicpb.NewMessage(output)
						}
						return response, nil
					},
				})
			}
			server.RegisterService(desc, struct{}{})
		}
		return true
	})
}

func incoming(ctx context.Context) metadata.MD {
	md, _ := metadata.FromIncomingContext(ctx)
	return md
}

// compileFiles compiles every .proto under the given testdata directories into one
// resolver, which is both what the server answers reflection out of and what the
// dynamic handlers decode against.
func compileFiles(t *testing.T, dirs ...string) *protoregistry.Files {
	t.Helper()
	return compileFilesWith(t, false, dirs...)
}

// compileFilesWith is that, with the comments kept or dropped: a server registers
// descriptors with no source info in them, which is why a reflected surface has no
// documentation on it — but one that keeps its comments hands them over.
func compileFilesWith(t *testing.T, sourceInfo bool, dirs ...string) *protoregistry.Files {
	t.Helper()
	set := &descriptorpb.FileDescriptorSet{}
	seen := map[string]bool{}
	for _, dir := range dirs {
		root := filepath.Join("testdata", dir)
		var names []string
		err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if !info.IsDir() && strings.HasSuffix(path, ".proto") {
				relative, err := filepath.Rel(root, path)
				if err != nil {
					return err
				}
				names = append(names, relative)
			}
			return nil
		})
		if err != nil {
			t.Fatalf("walk %s: %v", root, err)
		}
		options := []protoc.Option{protoc.WithProtoPaths(root), protoc.WithIncludeImports()}
		if sourceInfo {
			options = append(options, protoc.WithIncludeSourceInfo())
		}
		result, err := protoc.New(options...).Compile(names...)
		if err != nil {
			t.Fatalf("compile %s: %v", root, err)
		}
		for _, file := range result.Files {
			if seen[file.GetName()] {
				continue
			}
			seen[file.GetName()] = true
			set.File = append(set.File, file)
		}
	}
	files, err := protodesc.NewFiles(set)
	if err != nil {
		t.Fatalf("resolve descriptors: %v", err)
	}
	return files
}

// writeCerts writes a CA, a server certificate for 127.0.0.1 and a client
// certificate, and returns the paths of the CA bundle and the client pair.
func writeCerts(t *testing.T) (caFile, clientCert, clientKey string) {
	t.Helper()
	dir := t.TempDir()

	caKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	caTemplate := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "kaja deep test CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("ca: %v", err)
	}
	ca, _ := x509.ParseCertificate(caDER)

	caFile = filepath.Join(dir, "ca.pem")
	writePEM(t, caFile, "CERTIFICATE", caDER)

	serverDER, serverKey := issue(t, ca, caKey, "127.0.0.1", []net.IP{net.ParseIP("127.0.0.1")}, x509.ExtKeyUsageServerAuth)
	writePEM(t, filepath.Join(dir, "server.pem"), "CERTIFICATE", serverDER)
	writeKey(t, filepath.Join(dir, "server.key"), serverKey)

	clientDER, clientKeyPair := issue(t, ca, caKey, "kaja", nil, x509.ExtKeyUsageClientAuth)
	clientCert = filepath.Join(dir, "client.pem")
	clientKey = filepath.Join(dir, "client.key")
	writePEM(t, clientCert, "CERTIFICATE", clientDER)
	writeKey(t, clientKey, clientKeyPair)

	certsDir = dir
	return caFile, clientCert, clientKey
}

// certsDir is where the last writeCerts put the server pair, which serverCredentials
// reads back.
var certsDir string

func issue(t *testing.T, ca *x509.Certificate, caKey *ecdsa.PrivateKey, name string, ips []net.IP, usage x509.ExtKeyUsage) ([]byte, *ecdsa.PrivateKey) {
	t.Helper()
	key, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	template := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: name},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{usage},
		IPAddresses:  ips,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, ca, &key.PublicKey, caKey)
	if err != nil {
		t.Fatalf("certificate: %v", err)
	}
	return der, key
}

func writePEM(t *testing.T, path, kind string, der []byte) {
	t.Helper()
	if err := os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: kind, Bytes: der}), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func writeKey(t *testing.T, path string, key *ecdsa.PrivateKey) {
	t.Helper()
	der, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	writePEM(t, path, "EC PRIVATE KEY", der)
}

func serverCredentials(t *testing.T, caFile string, mutual bool) credentials.TransportCredentials {
	t.Helper()
	pair, err := tls.LoadX509KeyPair(filepath.Join(certsDir, "server.pem"), filepath.Join(certsDir, "server.key"))
	if err != nil {
		t.Fatalf("server key pair: %v", err)
	}
	configuration := &tls.Config{Certificates: []tls.Certificate{pair}}
	if mutual {
		pool := x509.NewCertPool()
		ca, err := os.ReadFile(caFile)
		if err != nil {
			t.Fatalf("read ca: %v", err)
		}
		pool.AppendCertsFromPEM(ca)
		configuration.ClientCAs = pool
		configuration.ClientAuth = tls.RequireAndVerifyClientCert
	}
	return credentials.NewTLS(configuration)
}

// failWith is the behaviour of a method that refuses every call.
func failWith(code codes.Code, message string) behavior {
	return func(*call) error { return status.Error(code, message) }
}
