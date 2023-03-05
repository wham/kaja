package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/twitchtv/twirp"
	"github.com/wham/kaja-twirp/internal/model"
)

func main() {
	router := gin.Default()
	router.LoadHTMLGlob("web/templates/*")
	router.Static("/assets", "web/assets")
	router.GET("/", func(c *gin.Context) {
		model := model.LoadModel()
		_, service, method := model.GetFirstMethod()

		c.Redirect(302, "/services/" + service.Name + "/" + method.Name)
	})
	router.GET("/services/:service/:method", func(c *gin.Context) {
		serviceName := c.Param("service")
		methodName := c.Param("method")

		m := model.LoadModel()

		_, service, method := m.GetMethod(serviceName, methodName)

		form := map[string]string{}

		for _, field := range method.Input.Fields {
			form[field.Name] = field.DefaultValue

			if form[field.Name] == "google.protobuf.Timestamp" {
				form[field.Name] = model.FormatTime(time.Now())
			}
		}

		c.HTML(http.StatusOK, "method.tmpl", gin.H{
			"files":   m.Files,
			"service": service,
			"method":  method,
			"form": form,
		})
	})
	router.POST("/services/:service/:method", func(c *gin.Context) {
		serviceName := c.Param("service")
		methodName := c.Param("method")

		m := model.LoadModel()
		// Use Overload() so the .env file can be dynamically updated
		godotenv.Overload()

		file, service, method := m.GetMethod(serviceName, methodName)

		baseURL := os.Getenv("BASE_URL")
		// Build method URLs: <baseURL>[<prefix>]/<package>.<Service>/<Method>
		serviceURL := sanitizeBaseURL(baseURL)
		// serviceURL += baseServicePath("twirp", "meuse.services.v1", serviceName)
		serviceURL += baseServicePath("twirp", file.Package, serviceName)


		c.MultipartForm()

		in := map[string]interface{}{}
		form := map[string]string{}

		for _, field := range method.Input.Fields {
			v := c.PostForm(field.Name)
			form[field.Name] = v

			if v == "" {
				continue
			}

			if field.Serialize == "array" {
				var j []interface{}
				if err := json.Unmarshal([]byte(v), &j); err != nil {
					c.AbortWithError(500, err)
				}
				in[field.Name] = j
			} else if field.Serialize == "object" {
				var j map[string]interface{}
				if err := json.Unmarshal([]byte(v), &j); err != nil {
					c.AbortWithError(500, err)
				}
				in[field.Name] = j
			} else if field.Serialize == "int" {
				in[field.Name], _ = strconv.Atoi(v)
			} else {
				in[field.Name] = v
			}
		}

		var out map[string]interface{}

		err := doJSONRequest(context.Background(), &http.Client{}, twirp.ClientOptions{}.Hooks, serviceURL+methodName, in, &out)

		res, _ := json.MarshalIndent(out, "", "  ");
		req, _ := json.MarshalIndent(in, "", "  ");

		dump := serviceURL + "\n\n" + string(req)

		c.HTML(http.StatusOK, "method.tmpl", gin.H{
			"files": m.Files,
			"service": service,
			"method":  method,
			"in": dump,
			"out":   string(res),
			"err":   err,
			"form": form,
		})
	})
	router.Run(":41520")
}

// doJSONRequest makes a JSON request to the remote Twirp service.
func doJSONRequest(ctx context.Context, client HTTPClient, hooks *twirp.ClientHooks, url string, in map[string]interface{}, out *map[string]interface{}) error {
	reqBytes, err := json.Marshal(in)
	if err != nil {
		return wrapInternal(err, "failed to marshal json request")
	}
	if err = ctx.Err(); err != nil {
		return wrapInternal(err, "aborted because context was done")
	}

	req, err := newRequest(ctx, url, bytes.NewReader(reqBytes), "application/json")
	if err != nil {
		return wrapInternal(err, "could not build request")
	}
	ctx, err = callClientRequestPrepared(ctx, hooks, req)
	if err != nil {
		return err
	}

	req = req.WithContext(ctx)
	resp, err := client.Do(req)
	if err != nil {
		return wrapInternal(err, "failed to do request")
	}

	defer func() {
		cerr := resp.Body.Close()
		if err == nil && cerr != nil {
			err = wrapInternal(cerr, "failed to close response body")
		}
	}()

	if err = ctx.Err(); err != nil {
		return wrapInternal(err, "aborted because context was done")
	}

	if resp.StatusCode != 200 {
		return errorFromResponse(resp)
	}

	d := json.NewDecoder(resp.Body)
	rawRespBody := json.RawMessage{}
	if err := d.Decode(&rawRespBody); err != nil {
		return wrapInternal(err, "failed to unmarshal json response")
	}
	if err = json.Unmarshal(rawRespBody, out); err != nil {
		return wrapInternal(err, "failed to unmarshal json response")
	}
	if err = ctx.Err(); err != nil {
		return wrapInternal(err, "aborted because context was done")
	}
	return nil
}

type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

func wrapInternal(err error, prefix string) twirp.Error {
	return twirp.InternalErrorWith(&wrappedError{prefix: prefix, cause: err})
}

type wrappedError struct {
	prefix string
	cause  error
}

func (e *wrappedError) Error() string { return e.prefix + ": " + e.cause.Error() }
func (e *wrappedError) Unwrap() error { return e.cause } // for go1.13 + errors.Is/As
func (e *wrappedError) Cause() error  { return e.cause } // for github.com/pkg/errors

// newRequest makes an http.Request from a client, adding common headers.
func newRequest(ctx context.Context, url string, reqBody io.Reader, contentType string) (*http.Request, error) {
	req, err := http.NewRequest("POST", url, reqBody)
	if err != nil {
		return nil, err
	}
	req = req.WithContext(ctx)
	if customHeader := getCustomHTTPReqHeaders(ctx); customHeader != nil {
		req.Header = customHeader
	}
	req.Header.Set("Accept", contentType)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Twirp-Version", "v8.1.1")

	ah := os.Getenv("AUTH_HEADER")

	if ah != "" {
		req.Header.Set(strings.Split(ah, ":")[0], strings.Split(ah, ":")[1])
	}

	return req, nil
}

// getCustomHTTPReqHeaders retrieves a copy of any headers that are set in
// a context through the twirp.WithHTTPRequestHeaders function.
// If there are no headers set, or if they have the wrong type, nil is returned.
func getCustomHTTPReqHeaders(ctx context.Context) http.Header {
	header, ok := twirp.HTTPRequestHeaders(ctx)
	if !ok || header == nil {
		return nil
	}
	copied := make(http.Header)
	for k, vv := range header {
		if vv == nil {
			copied[k] = nil
			continue
		}
		copied[k] = make([]string, len(vv))
		copy(copied[k], vv)
	}
	return copied
}

func callClientRequestPrepared(ctx context.Context, h *twirp.ClientHooks, req *http.Request) (context.Context, error) {
	if h == nil || h.RequestPrepared == nil {
		return ctx, nil
	}
	return h.RequestPrepared(ctx, req)
}

// errorFromResponse builds a twirp.Error from a non-200 HTTP response.
// If the response has a valid serialized Twirp error, then it's returned.
// If not, the response status code is used to generate a similar twirp
// error. See twirpErrorFromIntermediary for more info on intermediary errors.
func errorFromResponse(resp *http.Response) twirp.Error {
	statusCode := resp.StatusCode
	statusText := http.StatusText(statusCode)

	if isHTTPRedirect(statusCode) {
		// Unexpected redirect: it must be an error from an intermediary.
		// Twirp clients don't follow redirects automatically, Twirp only handles
		// POST requests, redirects should only happen on GET and HEAD requests.
		location := resp.Header.Get("Location")
		msg := fmt.Sprintf("unexpected HTTP status code %d %q received, Location=%q", statusCode, statusText, location)
		return twirpErrorFromIntermediary(statusCode, msg, location)
	}

	respBodyBytes, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return wrapInternal(err, "failed to read server error response body")
	}

	var tj twerrJSON
	dec := json.NewDecoder(bytes.NewReader(respBodyBytes))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&tj); err != nil || tj.Code == "" {
		// Invalid JSON response; it must be an error from an intermediary.
		msg := fmt.Sprintf("Error from intermediary with HTTP status code %d %q", statusCode, statusText)
		return twirpErrorFromIntermediary(statusCode, msg, string(respBodyBytes))
	}

	errorCode := twirp.ErrorCode(tj.Code)
	if !twirp.IsValidErrorCode(errorCode) {
		msg := "invalid type returned from server error response: " + tj.Code
		return twirp.InternalError(msg).WithMeta("body", string(respBodyBytes))
	}

	twerr := twirp.NewError(errorCode, tj.Msg)
	for k, v := range tj.Meta {
		twerr = twerr.WithMeta(k, v)
	}
	return twerr
}

func isHTTPRedirect(status int) bool {
	return status >= 300 && status <= 399
}

// twirpErrorFromIntermediary maps HTTP errors from non-twirp sources to twirp errors.
// The mapping is similar to gRPC: https://github.com/grpc/grpc/blob/master/doc/http-grpc-status-mapping.md.
// Returned twirp Errors have some additional metadata for inspection.
func twirpErrorFromIntermediary(status int, msg string, bodyOrLocation string) twirp.Error {
	var code twirp.ErrorCode
	if isHTTPRedirect(status) { // 3xx
		code = twirp.Internal
	} else {
		switch status {
		case 400: // Bad Request
			code = twirp.Internal
		case 401: // Unauthorized
			code = twirp.Unauthenticated
		case 403: // Forbidden
			code = twirp.PermissionDenied
		case 404: // Not Found
			code = twirp.BadRoute
		case 429: // Too Many Requests
			code = twirp.ResourceExhausted
		case 502, 503, 504: // Bad Gateway, Service Unavailable, Gateway Timeout
			code = twirp.Unavailable
		default: // All other codes
			code = twirp.Unknown
		}
	}

	twerr := twirp.NewError(code, msg)
	twerr = twerr.WithMeta("http_error_from_intermediary", "true") // to easily know if this error was from intermediary
	twerr = twerr.WithMeta("status_code", strconv.Itoa(status))
	if isHTTPRedirect(status) {
		twerr = twerr.WithMeta("location", bodyOrLocation)
	} else {
		twerr = twerr.WithMeta("body", bodyOrLocation)
	}
	return twerr
}

// JSON serialization for errors
type twerrJSON struct {
	Code string            `json:"code"`
	Msg  string            `json:"msg"`
	Meta map[string]string `json:"meta,omitempty"`
}

// sanitizeBaseURL parses the the baseURL, and adds the "http" scheme if needed.
// If the URL is unparsable, the baseURL is returned unchaged.
func sanitizeBaseURL(baseURL string) string {
	u, err := url.Parse(baseURL)
	if err != nil {
		return baseURL // invalid URL will fail later when making requests
	}
	if u.Scheme == "" {
		u.Scheme = "http"
	}
	return u.String()
}

// baseServicePath composes the path prefix for the service (without <Method>).
// e.g.: baseServicePath("/twirp", "my.pkg", "MyService")
//
//	returns => "/twirp/my.pkg.MyService/"
//
// e.g.: baseServicePath("", "", "MyService")
//
//	returns => "/MyService/"
func baseServicePath(prefix, pkg, service string) string {
	fullServiceName := service
	if pkg != "" {
		fullServiceName = pkg + "." + service
	}
	return path.Join("/", prefix, fullServiceName) + "/"
}
