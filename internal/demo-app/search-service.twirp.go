// Code generated by protoc-gen-twirp v8.1.3, DO NOT EDIT.
// source: search-service.proto

package demo_app

import context "context"
import fmt "fmt"
import http "net/http"
import io "io"
import json "encoding/json"
import strconv "strconv"
import strings "strings"

import protojson "google.golang.org/protobuf/encoding/protojson"
import proto "google.golang.org/protobuf/proto"
import twirp "github.com/twitchtv/twirp"
import ctxsetters "github.com/twitchtv/twirp/ctxsetters"

// Version compatibility assertion.
// If the constant is not defined in the package, that likely means
// the package needs to be updated to work with this generated code.
// See https://twitchtv.github.io/twirp/docs/version_matrix.html
const _ = twirp.TwirpPackageMinVersion_8_1_0

// =======================
// SearchService Interface
// =======================

type SearchService interface {
	Search(context.Context, *SearchRequest) (*SearchResponse, error)

	Index(context.Context, *IndexRequest) (*IndexResponse, error)
}

// =============================
// SearchService Protobuf Client
// =============================

type searchServiceProtobufClient struct {
	client      HTTPClient
	urls        [2]string
	interceptor twirp.Interceptor
	opts        twirp.ClientOptions
}

// NewSearchServiceProtobufClient creates a Protobuf client that implements the SearchService interface.
// It communicates using Protobuf and can be configured with a custom HTTPClient.
func NewSearchServiceProtobufClient(baseURL string, client HTTPClient, opts ...twirp.ClientOption) SearchService {
	if c, ok := client.(*http.Client); ok {
		client = withoutRedirects(c)
	}

	clientOpts := twirp.ClientOptions{}
	for _, o := range opts {
		o(&clientOpts)
	}

	// Using ReadOpt allows backwards and forwards compatibility with new options in the future
	literalURLs := false
	_ = clientOpts.ReadOpt("literalURLs", &literalURLs)
	var pathPrefix string
	if ok := clientOpts.ReadOpt("pathPrefix", &pathPrefix); !ok {
		pathPrefix = "/twirp" // default prefix
	}

	// Build method URLs: <baseURL>[<prefix>]/<package>.<Service>/<Method>
	serviceURL := sanitizeBaseURL(baseURL)
	serviceURL += baseServicePath(pathPrefix, "", "SearchService")
	urls := [2]string{
		serviceURL + "Search",
		serviceURL + "Index",
	}

	return &searchServiceProtobufClient{
		client:      client,
		urls:        urls,
		interceptor: twirp.ChainInterceptors(clientOpts.Interceptors...),
		opts:        clientOpts,
	}
}

func (c *searchServiceProtobufClient) Search(ctx context.Context, in *SearchRequest) (*SearchResponse, error) {
	ctx = ctxsetters.WithPackageName(ctx, "")
	ctx = ctxsetters.WithServiceName(ctx, "SearchService")
	ctx = ctxsetters.WithMethodName(ctx, "Search")
	caller := c.callSearch
	if c.interceptor != nil {
		caller = func(ctx context.Context, req *SearchRequest) (*SearchResponse, error) {
			resp, err := c.interceptor(
				func(ctx context.Context, req interface{}) (interface{}, error) {
					typedReq, ok := req.(*SearchRequest)
					if !ok {
						return nil, twirp.InternalError("failed type assertion req.(*SearchRequest) when calling interceptor")
					}
					return c.callSearch(ctx, typedReq)
				},
			)(ctx, req)
			if resp != nil {
				typedResp, ok := resp.(*SearchResponse)
				if !ok {
					return nil, twirp.InternalError("failed type assertion resp.(*SearchResponse) when calling interceptor")
				}
				return typedResp, err
			}
			return nil, err
		}
	}
	return caller(ctx, in)
}

func (c *searchServiceProtobufClient) callSearch(ctx context.Context, in *SearchRequest) (*SearchResponse, error) {
	out := new(SearchResponse)
	ctx, err := doProtobufRequest(ctx, c.client, c.opts.Hooks, c.urls[0], in, out)
	if err != nil {
		twerr, ok := err.(twirp.Error)
		if !ok {
			twerr = twirp.InternalErrorWith(err)
		}
		callClientError(ctx, c.opts.Hooks, twerr)
		return nil, err
	}

	callClientResponseReceived(ctx, c.opts.Hooks)

	return out, nil
}

func (c *searchServiceProtobufClient) Index(ctx context.Context, in *IndexRequest) (*IndexResponse, error) {
	ctx = ctxsetters.WithPackageName(ctx, "")
	ctx = ctxsetters.WithServiceName(ctx, "SearchService")
	ctx = ctxsetters.WithMethodName(ctx, "Index")
	caller := c.callIndex
	if c.interceptor != nil {
		caller = func(ctx context.Context, req *IndexRequest) (*IndexResponse, error) {
			resp, err := c.interceptor(
				func(ctx context.Context, req interface{}) (interface{}, error) {
					typedReq, ok := req.(*IndexRequest)
					if !ok {
						return nil, twirp.InternalError("failed type assertion req.(*IndexRequest) when calling interceptor")
					}
					return c.callIndex(ctx, typedReq)
				},
			)(ctx, req)
			if resp != nil {
				typedResp, ok := resp.(*IndexResponse)
				if !ok {
					return nil, twirp.InternalError("failed type assertion resp.(*IndexResponse) when calling interceptor")
				}
				return typedResp, err
			}
			return nil, err
		}
	}
	return caller(ctx, in)
}

func (c *searchServiceProtobufClient) callIndex(ctx context.Context, in *IndexRequest) (*IndexResponse, error) {
	out := new(IndexResponse)
	ctx, err := doProtobufRequest(ctx, c.client, c.opts.Hooks, c.urls[1], in, out)
	if err != nil {
		twerr, ok := err.(twirp.Error)
		if !ok {
			twerr = twirp.InternalErrorWith(err)
		}
		callClientError(ctx, c.opts.Hooks, twerr)
		return nil, err
	}

	callClientResponseReceived(ctx, c.opts.Hooks)

	return out, nil
}

// =========================
// SearchService JSON Client
// =========================

type searchServiceJSONClient struct {
	client      HTTPClient
	urls        [2]string
	interceptor twirp.Interceptor
	opts        twirp.ClientOptions
}

// NewSearchServiceJSONClient creates a JSON client that implements the SearchService interface.
// It communicates using JSON and can be configured with a custom HTTPClient.
func NewSearchServiceJSONClient(baseURL string, client HTTPClient, opts ...twirp.ClientOption) SearchService {
	if c, ok := client.(*http.Client); ok {
		client = withoutRedirects(c)
	}

	clientOpts := twirp.ClientOptions{}
	for _, o := range opts {
		o(&clientOpts)
	}

	// Using ReadOpt allows backwards and forwards compatibility with new options in the future
	literalURLs := false
	_ = clientOpts.ReadOpt("literalURLs", &literalURLs)
	var pathPrefix string
	if ok := clientOpts.ReadOpt("pathPrefix", &pathPrefix); !ok {
		pathPrefix = "/twirp" // default prefix
	}

	// Build method URLs: <baseURL>[<prefix>]/<package>.<Service>/<Method>
	serviceURL := sanitizeBaseURL(baseURL)
	serviceURL += baseServicePath(pathPrefix, "", "SearchService")
	urls := [2]string{
		serviceURL + "Search",
		serviceURL + "Index",
	}

	return &searchServiceJSONClient{
		client:      client,
		urls:        urls,
		interceptor: twirp.ChainInterceptors(clientOpts.Interceptors...),
		opts:        clientOpts,
	}
}

func (c *searchServiceJSONClient) Search(ctx context.Context, in *SearchRequest) (*SearchResponse, error) {
	ctx = ctxsetters.WithPackageName(ctx, "")
	ctx = ctxsetters.WithServiceName(ctx, "SearchService")
	ctx = ctxsetters.WithMethodName(ctx, "Search")
	caller := c.callSearch
	if c.interceptor != nil {
		caller = func(ctx context.Context, req *SearchRequest) (*SearchResponse, error) {
			resp, err := c.interceptor(
				func(ctx context.Context, req interface{}) (interface{}, error) {
					typedReq, ok := req.(*SearchRequest)
					if !ok {
						return nil, twirp.InternalError("failed type assertion req.(*SearchRequest) when calling interceptor")
					}
					return c.callSearch(ctx, typedReq)
				},
			)(ctx, req)
			if resp != nil {
				typedResp, ok := resp.(*SearchResponse)
				if !ok {
					return nil, twirp.InternalError("failed type assertion resp.(*SearchResponse) when calling interceptor")
				}
				return typedResp, err
			}
			return nil, err
		}
	}
	return caller(ctx, in)
}

func (c *searchServiceJSONClient) callSearch(ctx context.Context, in *SearchRequest) (*SearchResponse, error) {
	out := new(SearchResponse)
	ctx, err := doJSONRequest(ctx, c.client, c.opts.Hooks, c.urls[0], in, out)
	if err != nil {
		twerr, ok := err.(twirp.Error)
		if !ok {
			twerr = twirp.InternalErrorWith(err)
		}
		callClientError(ctx, c.opts.Hooks, twerr)
		return nil, err
	}

	callClientResponseReceived(ctx, c.opts.Hooks)

	return out, nil
}

func (c *searchServiceJSONClient) Index(ctx context.Context, in *IndexRequest) (*IndexResponse, error) {
	ctx = ctxsetters.WithPackageName(ctx, "")
	ctx = ctxsetters.WithServiceName(ctx, "SearchService")
	ctx = ctxsetters.WithMethodName(ctx, "Index")
	caller := c.callIndex
	if c.interceptor != nil {
		caller = func(ctx context.Context, req *IndexRequest) (*IndexResponse, error) {
			resp, err := c.interceptor(
				func(ctx context.Context, req interface{}) (interface{}, error) {
					typedReq, ok := req.(*IndexRequest)
					if !ok {
						return nil, twirp.InternalError("failed type assertion req.(*IndexRequest) when calling interceptor")
					}
					return c.callIndex(ctx, typedReq)
				},
			)(ctx, req)
			if resp != nil {
				typedResp, ok := resp.(*IndexResponse)
				if !ok {
					return nil, twirp.InternalError("failed type assertion resp.(*IndexResponse) when calling interceptor")
				}
				return typedResp, err
			}
			return nil, err
		}
	}
	return caller(ctx, in)
}

func (c *searchServiceJSONClient) callIndex(ctx context.Context, in *IndexRequest) (*IndexResponse, error) {
	out := new(IndexResponse)
	ctx, err := doJSONRequest(ctx, c.client, c.opts.Hooks, c.urls[1], in, out)
	if err != nil {
		twerr, ok := err.(twirp.Error)
		if !ok {
			twerr = twirp.InternalErrorWith(err)
		}
		callClientError(ctx, c.opts.Hooks, twerr)
		return nil, err
	}

	callClientResponseReceived(ctx, c.opts.Hooks)

	return out, nil
}

// ============================
// SearchService Server Handler
// ============================

type searchServiceServer struct {
	SearchService
	interceptor      twirp.Interceptor
	hooks            *twirp.ServerHooks
	pathPrefix       string // prefix for routing
	jsonSkipDefaults bool   // do not include unpopulated fields (default values) in the response
	jsonCamelCase    bool   // JSON fields are serialized as lowerCamelCase rather than keeping the original proto names
}

// NewSearchServiceServer builds a TwirpServer that can be used as an http.Handler to handle
// HTTP requests that are routed to the right method in the provided svc implementation.
// The opts are twirp.ServerOption modifiers, for example twirp.WithServerHooks(hooks).
func NewSearchServiceServer(svc SearchService, opts ...interface{}) TwirpServer {
	serverOpts := newServerOpts(opts)

	// Using ReadOpt allows backwards and forwards compatibility with new options in the future
	jsonSkipDefaults := false
	_ = serverOpts.ReadOpt("jsonSkipDefaults", &jsonSkipDefaults)
	jsonCamelCase := false
	_ = serverOpts.ReadOpt("jsonCamelCase", &jsonCamelCase)
	var pathPrefix string
	if ok := serverOpts.ReadOpt("pathPrefix", &pathPrefix); !ok {
		pathPrefix = "/twirp" // default prefix
	}

	return &searchServiceServer{
		SearchService:    svc,
		hooks:            serverOpts.Hooks,
		interceptor:      twirp.ChainInterceptors(serverOpts.Interceptors...),
		pathPrefix:       pathPrefix,
		jsonSkipDefaults: jsonSkipDefaults,
		jsonCamelCase:    jsonCamelCase,
	}
}

// writeError writes an HTTP response with a valid Twirp error format, and triggers hooks.
// If err is not a twirp.Error, it will get wrapped with twirp.InternalErrorWith(err)
func (s *searchServiceServer) writeError(ctx context.Context, resp http.ResponseWriter, err error) {
	writeError(ctx, resp, err, s.hooks)
}

// handleRequestBodyError is used to handle error when the twirp server cannot read request
func (s *searchServiceServer) handleRequestBodyError(ctx context.Context, resp http.ResponseWriter, msg string, err error) {
	if context.Canceled == ctx.Err() {
		s.writeError(ctx, resp, twirp.NewError(twirp.Canceled, "failed to read request: context canceled"))
		return
	}
	if context.DeadlineExceeded == ctx.Err() {
		s.writeError(ctx, resp, twirp.NewError(twirp.DeadlineExceeded, "failed to read request: deadline exceeded"))
		return
	}
	s.writeError(ctx, resp, twirp.WrapError(malformedRequestError(msg), err))
}

// SearchServicePathPrefix is a convenience constant that may identify URL paths.
// Should be used with caution, it only matches routes generated by Twirp Go clients,
// with the default "/twirp" prefix and default CamelCase service and method names.
// More info: https://twitchtv.github.io/twirp/docs/routing.html
const SearchServicePathPrefix = "/twirp/SearchService/"

func (s *searchServiceServer) ServeHTTP(resp http.ResponseWriter, req *http.Request) {
	ctx := req.Context()
	ctx = ctxsetters.WithPackageName(ctx, "")
	ctx = ctxsetters.WithServiceName(ctx, "SearchService")
	ctx = ctxsetters.WithResponseWriter(ctx, resp)

	var err error
	ctx, err = callRequestReceived(ctx, s.hooks)
	if err != nil {
		s.writeError(ctx, resp, err)
		return
	}

	if req.Method != "POST" {
		msg := fmt.Sprintf("unsupported method %q (only POST is allowed)", req.Method)
		s.writeError(ctx, resp, badRouteError(msg, req.Method, req.URL.Path))
		return
	}

	// Verify path format: [<prefix>]/<package>.<Service>/<Method>
	prefix, pkgService, method := parseTwirpPath(req.URL.Path)
	if pkgService != "SearchService" {
		msg := fmt.Sprintf("no handler for path %q", req.URL.Path)
		s.writeError(ctx, resp, badRouteError(msg, req.Method, req.URL.Path))
		return
	}
	if prefix != s.pathPrefix {
		msg := fmt.Sprintf("invalid path prefix %q, expected %q, on path %q", prefix, s.pathPrefix, req.URL.Path)
		s.writeError(ctx, resp, badRouteError(msg, req.Method, req.URL.Path))
		return
	}

	switch method {
	case "Search":
		s.serveSearch(ctx, resp, req)
		return
	case "Index":
		s.serveIndex(ctx, resp, req)
		return
	default:
		msg := fmt.Sprintf("no handler for path %q", req.URL.Path)
		s.writeError(ctx, resp, badRouteError(msg, req.Method, req.URL.Path))
		return
	}
}

func (s *searchServiceServer) serveSearch(ctx context.Context, resp http.ResponseWriter, req *http.Request) {
	header := req.Header.Get("Content-Type")
	i := strings.Index(header, ";")
	if i == -1 {
		i = len(header)
	}
	switch strings.TrimSpace(strings.ToLower(header[:i])) {
	case "application/json":
		s.serveSearchJSON(ctx, resp, req)
	case "application/protobuf":
		s.serveSearchProtobuf(ctx, resp, req)
	default:
		msg := fmt.Sprintf("unexpected Content-Type: %q", req.Header.Get("Content-Type"))
		twerr := badRouteError(msg, req.Method, req.URL.Path)
		s.writeError(ctx, resp, twerr)
	}
}

func (s *searchServiceServer) serveSearchJSON(ctx context.Context, resp http.ResponseWriter, req *http.Request) {
	var err error
	ctx = ctxsetters.WithMethodName(ctx, "Search")
	ctx, err = callRequestRouted(ctx, s.hooks)
	if err != nil {
		s.writeError(ctx, resp, err)
		return
	}

	d := json.NewDecoder(req.Body)
	rawReqBody := json.RawMessage{}
	if err := d.Decode(&rawReqBody); err != nil {
		s.handleRequestBodyError(ctx, resp, "the json request could not be decoded", err)
		return
	}
	reqContent := new(SearchRequest)
	unmarshaler := protojson.UnmarshalOptions{DiscardUnknown: true}
	if err = unmarshaler.Unmarshal(rawReqBody, reqContent); err != nil {
		s.handleRequestBodyError(ctx, resp, "the json request could not be decoded", err)
		return
	}

	handler := s.SearchService.Search
	if s.interceptor != nil {
		handler = func(ctx context.Context, req *SearchRequest) (*SearchResponse, error) {
			resp, err := s.interceptor(
				func(ctx context.Context, req interface{}) (interface{}, error) {
					typedReq, ok := req.(*SearchRequest)
					if !ok {
						return nil, twirp.InternalError("failed type assertion req.(*SearchRequest) when calling interceptor")
					}
					return s.SearchService.Search(ctx, typedReq)
				},
			)(ctx, req)
			if resp != nil {
				typedResp, ok := resp.(*SearchResponse)
				if !ok {
					return nil, twirp.InternalError("failed type assertion resp.(*SearchResponse) when calling interceptor")
				}
				return typedResp, err
			}
			return nil, err
		}
	}

	// Call service method
	var respContent *SearchResponse
	func() {
		defer ensurePanicResponses(ctx, resp, s.hooks)
		respContent, err = handler(ctx, reqContent)
	}()

	if err != nil {
		s.writeError(ctx, resp, err)
		return
	}
	if respContent == nil {
		s.writeError(ctx, resp, twirp.InternalError("received a nil *SearchResponse and nil error while calling Search. nil responses are not supported"))
		return
	}

	ctx = callResponsePrepared(ctx, s.hooks)

	marshaler := &protojson.MarshalOptions{UseProtoNames: !s.jsonCamelCase, EmitUnpopulated: !s.jsonSkipDefaults}
	respBytes, err := marshaler.Marshal(respContent)
	if err != nil {
		s.writeError(ctx, resp, wrapInternal(err, "failed to marshal json response"))
		return
	}

	ctx = ctxsetters.WithStatusCode(ctx, http.StatusOK)
	resp.Header().Set("Content-Type", "application/json")
	resp.Header().Set("Content-Length", strconv.Itoa(len(respBytes)))
	resp.WriteHeader(http.StatusOK)

	if n, err := resp.Write(respBytes); err != nil {
		msg := fmt.Sprintf("failed to write response, %d of %d bytes written: %s", n, len(respBytes), err.Error())
		twerr := twirp.NewError(twirp.Unknown, msg)
		ctx = callError(ctx, s.hooks, twerr)
	}
	callResponseSent(ctx, s.hooks)
}

func (s *searchServiceServer) serveSearchProtobuf(ctx context.Context, resp http.ResponseWriter, req *http.Request) {
	var err error
	ctx = ctxsetters.WithMethodName(ctx, "Search")
	ctx, err = callRequestRouted(ctx, s.hooks)
	if err != nil {
		s.writeError(ctx, resp, err)
		return
	}

	buf, err := io.ReadAll(req.Body)
	if err != nil {
		s.handleRequestBodyError(ctx, resp, "failed to read request body", err)
		return
	}
	reqContent := new(SearchRequest)
	if err = proto.Unmarshal(buf, reqContent); err != nil {
		s.writeError(ctx, resp, malformedRequestError("the protobuf request could not be decoded"))
		return
	}

	handler := s.SearchService.Search
	if s.interceptor != nil {
		handler = func(ctx context.Context, req *SearchRequest) (*SearchResponse, error) {
			resp, err := s.interceptor(
				func(ctx context.Context, req interface{}) (interface{}, error) {
					typedReq, ok := req.(*SearchRequest)
					if !ok {
						return nil, twirp.InternalError("failed type assertion req.(*SearchRequest) when calling interceptor")
					}
					return s.SearchService.Search(ctx, typedReq)
				},
			)(ctx, req)
			if resp != nil {
				typedResp, ok := resp.(*SearchResponse)
				if !ok {
					return nil, twirp.InternalError("failed type assertion resp.(*SearchResponse) when calling interceptor")
				}
				return typedResp, err
			}
			return nil, err
		}
	}

	// Call service method
	var respContent *SearchResponse
	func() {
		defer ensurePanicResponses(ctx, resp, s.hooks)
		respContent, err = handler(ctx, reqContent)
	}()

	if err != nil {
		s.writeError(ctx, resp, err)
		return
	}
	if respContent == nil {
		s.writeError(ctx, resp, twirp.InternalError("received a nil *SearchResponse and nil error while calling Search. nil responses are not supported"))
		return
	}

	ctx = callResponsePrepared(ctx, s.hooks)

	respBytes, err := proto.Marshal(respContent)
	if err != nil {
		s.writeError(ctx, resp, wrapInternal(err, "failed to marshal proto response"))
		return
	}

	ctx = ctxsetters.WithStatusCode(ctx, http.StatusOK)
	resp.Header().Set("Content-Type", "application/protobuf")
	resp.Header().Set("Content-Length", strconv.Itoa(len(respBytes)))
	resp.WriteHeader(http.StatusOK)
	if n, err := resp.Write(respBytes); err != nil {
		msg := fmt.Sprintf("failed to write response, %d of %d bytes written: %s", n, len(respBytes), err.Error())
		twerr := twirp.NewError(twirp.Unknown, msg)
		ctx = callError(ctx, s.hooks, twerr)
	}
	callResponseSent(ctx, s.hooks)
}

func (s *searchServiceServer) serveIndex(ctx context.Context, resp http.ResponseWriter, req *http.Request) {
	header := req.Header.Get("Content-Type")
	i := strings.Index(header, ";")
	if i == -1 {
		i = len(header)
	}
	switch strings.TrimSpace(strings.ToLower(header[:i])) {
	case "application/json":
		s.serveIndexJSON(ctx, resp, req)
	case "application/protobuf":
		s.serveIndexProtobuf(ctx, resp, req)
	default:
		msg := fmt.Sprintf("unexpected Content-Type: %q", req.Header.Get("Content-Type"))
		twerr := badRouteError(msg, req.Method, req.URL.Path)
		s.writeError(ctx, resp, twerr)
	}
}

func (s *searchServiceServer) serveIndexJSON(ctx context.Context, resp http.ResponseWriter, req *http.Request) {
	var err error
	ctx = ctxsetters.WithMethodName(ctx, "Index")
	ctx, err = callRequestRouted(ctx, s.hooks)
	if err != nil {
		s.writeError(ctx, resp, err)
		return
	}

	d := json.NewDecoder(req.Body)
	rawReqBody := json.RawMessage{}
	if err := d.Decode(&rawReqBody); err != nil {
		s.handleRequestBodyError(ctx, resp, "the json request could not be decoded", err)
		return
	}
	reqContent := new(IndexRequest)
	unmarshaler := protojson.UnmarshalOptions{DiscardUnknown: true}
	if err = unmarshaler.Unmarshal(rawReqBody, reqContent); err != nil {
		s.handleRequestBodyError(ctx, resp, "the json request could not be decoded", err)
		return
	}

	handler := s.SearchService.Index
	if s.interceptor != nil {
		handler = func(ctx context.Context, req *IndexRequest) (*IndexResponse, error) {
			resp, err := s.interceptor(
				func(ctx context.Context, req interface{}) (interface{}, error) {
					typedReq, ok := req.(*IndexRequest)
					if !ok {
						return nil, twirp.InternalError("failed type assertion req.(*IndexRequest) when calling interceptor")
					}
					return s.SearchService.Index(ctx, typedReq)
				},
			)(ctx, req)
			if resp != nil {
				typedResp, ok := resp.(*IndexResponse)
				if !ok {
					return nil, twirp.InternalError("failed type assertion resp.(*IndexResponse) when calling interceptor")
				}
				return typedResp, err
			}
			return nil, err
		}
	}

	// Call service method
	var respContent *IndexResponse
	func() {
		defer ensurePanicResponses(ctx, resp, s.hooks)
		respContent, err = handler(ctx, reqContent)
	}()

	if err != nil {
		s.writeError(ctx, resp, err)
		return
	}
	if respContent == nil {
		s.writeError(ctx, resp, twirp.InternalError("received a nil *IndexResponse and nil error while calling Index. nil responses are not supported"))
		return
	}

	ctx = callResponsePrepared(ctx, s.hooks)

	marshaler := &protojson.MarshalOptions{UseProtoNames: !s.jsonCamelCase, EmitUnpopulated: !s.jsonSkipDefaults}
	respBytes, err := marshaler.Marshal(respContent)
	if err != nil {
		s.writeError(ctx, resp, wrapInternal(err, "failed to marshal json response"))
		return
	}

	ctx = ctxsetters.WithStatusCode(ctx, http.StatusOK)
	resp.Header().Set("Content-Type", "application/json")
	resp.Header().Set("Content-Length", strconv.Itoa(len(respBytes)))
	resp.WriteHeader(http.StatusOK)

	if n, err := resp.Write(respBytes); err != nil {
		msg := fmt.Sprintf("failed to write response, %d of %d bytes written: %s", n, len(respBytes), err.Error())
		twerr := twirp.NewError(twirp.Unknown, msg)
		ctx = callError(ctx, s.hooks, twerr)
	}
	callResponseSent(ctx, s.hooks)
}

func (s *searchServiceServer) serveIndexProtobuf(ctx context.Context, resp http.ResponseWriter, req *http.Request) {
	var err error
	ctx = ctxsetters.WithMethodName(ctx, "Index")
	ctx, err = callRequestRouted(ctx, s.hooks)
	if err != nil {
		s.writeError(ctx, resp, err)
		return
	}

	buf, err := io.ReadAll(req.Body)
	if err != nil {
		s.handleRequestBodyError(ctx, resp, "failed to read request body", err)
		return
	}
	reqContent := new(IndexRequest)
	if err = proto.Unmarshal(buf, reqContent); err != nil {
		s.writeError(ctx, resp, malformedRequestError("the protobuf request could not be decoded"))
		return
	}

	handler := s.SearchService.Index
	if s.interceptor != nil {
		handler = func(ctx context.Context, req *IndexRequest) (*IndexResponse, error) {
			resp, err := s.interceptor(
				func(ctx context.Context, req interface{}) (interface{}, error) {
					typedReq, ok := req.(*IndexRequest)
					if !ok {
						return nil, twirp.InternalError("failed type assertion req.(*IndexRequest) when calling interceptor")
					}
					return s.SearchService.Index(ctx, typedReq)
				},
			)(ctx, req)
			if resp != nil {
				typedResp, ok := resp.(*IndexResponse)
				if !ok {
					return nil, twirp.InternalError("failed type assertion resp.(*IndexResponse) when calling interceptor")
				}
				return typedResp, err
			}
			return nil, err
		}
	}

	// Call service method
	var respContent *IndexResponse
	func() {
		defer ensurePanicResponses(ctx, resp, s.hooks)
		respContent, err = handler(ctx, reqContent)
	}()

	if err != nil {
		s.writeError(ctx, resp, err)
		return
	}
	if respContent == nil {
		s.writeError(ctx, resp, twirp.InternalError("received a nil *IndexResponse and nil error while calling Index. nil responses are not supported"))
		return
	}

	ctx = callResponsePrepared(ctx, s.hooks)

	respBytes, err := proto.Marshal(respContent)
	if err != nil {
		s.writeError(ctx, resp, wrapInternal(err, "failed to marshal proto response"))
		return
	}

	ctx = ctxsetters.WithStatusCode(ctx, http.StatusOK)
	resp.Header().Set("Content-Type", "application/protobuf")
	resp.Header().Set("Content-Length", strconv.Itoa(len(respBytes)))
	resp.WriteHeader(http.StatusOK)
	if n, err := resp.Write(respBytes); err != nil {
		msg := fmt.Sprintf("failed to write response, %d of %d bytes written: %s", n, len(respBytes), err.Error())
		twerr := twirp.NewError(twirp.Unknown, msg)
		ctx = callError(ctx, s.hooks, twerr)
	}
	callResponseSent(ctx, s.hooks)
}

func (s *searchServiceServer) ServiceDescriptor() ([]byte, int) {
	return twirpFileDescriptor1, 0
}

func (s *searchServiceServer) ProtocGenTwirpVersion() string {
	return "v8.1.3"
}

// PathPrefix returns the base service path, in the form: "/<prefix>/<package>.<Service>/"
// that is everything in a Twirp route except for the <Method>. This can be used for routing,
// for example to identify the requests that are targeted to this service in a mux.
func (s *searchServiceServer) PathPrefix() string {
	return baseServicePath(s.pathPrefix, "", "SearchService")
}

var twirpFileDescriptor1 = []byte{
	// 399 bytes of a gzipped FileDescriptorProto
	0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0xff, 0x84, 0x92, 0x41, 0x6f, 0xd3, 0x30,
	0x14, 0xc7, 0x09, 0x69, 0xbb, 0xf6, 0x6d, 0x6d, 0x33, 0x77, 0x87, 0xa8, 0x97, 0x85, 0x48, 0x4c,
	0x01, 0xb4, 0x00, 0xdd, 0x27, 0x60, 0x9c, 0x7a, 0x60, 0x89, 0xdc, 0x9c, 0xb8, 0x44, 0x6e, 0xf3,
	0x34, 0x2c, 0x65, 0x8e, 0x67, 0x3b, 0x08, 0xce, 0x7c, 0x71, 0x14, 0x3b, 0x29, 0x1b, 0x97, 0xdd,
	0xfc, 0x7e, 0xcf, 0xd2, 0xff, 0xa7, 0xf7, 0x1e, 0x5c, 0x68, 0x64, 0xea, 0xf0, 0xe3, 0x5a, 0xa3,
	0xfa, 0xc9, 0x0f, 0x98, 0x4a, 0xd5, 0x98, 0x26, 0x16, 0x30, 0xdf, 0x59, 0x4e, 0xf1, 0xb1, 0x45,
	0x6d, 0xc8, 0x05, 0x8c, 0x1f, 0x5b, 0x54, 0xbf, 0x43, 0x2f, 0xf2, 0x92, 0x19, 0x75, 0x05, 0xb9,
	0x84, 0x53, 0xc9, 0xee, 0xb1, 0x14, 0xed, 0xc3, 0x1e, 0x55, 0xf8, 0x3a, 0xf2, 0x92, 0x31, 0x85,
	0x0e, 0xdd, 0x59, 0x42, 0xae, 0x60, 0xa9, 0x50, 0xb7, 0xb5, 0x29, 0x25, 0xaa, 0xb2, 0x6b, 0x84,
	0xbe, 0xfd, 0x34, 0x77, 0x38, 0x47, 0x95, 0xb3, 0x7b, 0x8c, 0x6f, 0x60, 0x31, 0xe4, 0x69, 0xd9,
	0x08, 0x8d, 0xe4, 0x0d, 0x9c, 0xb8, 0x2f, 0x3a, 0xf4, 0x22, 0x3f, 0x39, 0xdd, 0x9c, 0xa4, 0xd4,
	0xd6, 0x74, 0xe0, 0x31, 0x83, 0x89, 0x43, 0x24, 0x00, 0xbf, 0x55, 0x75, 0xef, 0xd6, 0x3d, 0x3b,
	0x5f, 0xc3, 0x4d, 0x8d, 0xd6, 0x69, 0x46, 0x5d, 0x41, 0xd6, 0x30, 0xd5, 0x82, 0x4b, 0x89, 0x46,
	0x87, 0x7e, 0xe4, 0x27, 0x33, 0x7a, 0xac, 0xc9, 0x0a, 0xc6, 0x5c, 0x97, 0xac, 0x0a, 0x47, 0x91,
	0x97, 0x4c, 0xe9, 0x88, 0xeb, 0x2f, 0x55, 0xfc, 0xc7, 0x83, 0xb3, 0xad, 0xa8, 0xf0, 0xd7, 0x30,
	0x87, 0x4b, 0x98, 0xb8, 0x78, 0x1b, 0xf6, 0xc4, 0xaa, 0xc7, 0xe4, 0x2d, 0x4c, 0x65, 0xa3, 0xb9,
	0xe1, 0x8d, 0xb0, 0xd9, 0x8b, 0xcd, 0x2c, 0xcd, 0x7b, 0x40, 0x8f, 0x2d, 0xf2, 0x01, 0xce, 0x59,
	0x55, 0xd9, 0x37, 0xab, 0xcb, 0x43, 0x23, 0x39, 0x6a, 0x3b, 0x9a, 0x11, 0x0d, 0xfe, 0x35, 0xbe,
	0x5a, 0x1e, 0x7f, 0x82, 0x79, 0x2f, 0xd1, 0x0f, 0xe7, 0x25, 0x8b, 0xf7, 0x9f, 0x61, 0x3a, 0x84,
	0x92, 0x00, 0xce, 0xf2, 0x6c, 0xb7, 0x2d, 0xb6, 0xd9, 0x5d, 0x59, 0x64, 0x79, 0xf0, 0x8a, 0xac,
	0x60, 0x79, 0x24, 0xb7, 0x59, 0x51, 0x64, 0xdf, 0x02, 0x6f, 0xb3, 0x1f, 0x56, 0xbe, 0x73, 0x97,
	0x40, 0xde, 0xc1, 0xc4, 0x01, 0xb2, 0x48, 0x9f, 0x1d, 0xc3, 0x7a, 0x99, 0xfe, 0xb7, 0xac, 0x2b,
	0x18, 0x5b, 0x41, 0x32, 0x4f, 0x9f, 0x4e, 0x6b, 0xbd, 0x48, 0x9f, 0x79, 0xdf, 0xae, 0xbe, 0x9f,
	0x73, 0x61, 0x50, 0x09, 0x56, 0x7f, 0xac, 0xf0, 0xa1, 0xb9, 0x66, 0x52, 0xee, 0x27, 0xf6, 0xe4,
	0x6e, 0xfe, 0x06, 0x00, 0x00, 0xff, 0xff, 0x41, 0xc9, 0x36, 0x07, 0x8a, 0x02, 0x00, 0x00,
}
