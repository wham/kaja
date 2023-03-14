package client

import (
	"fmt"
	"net/url"
	"os"
	"path"
	"strings"
)

func GetBaseURL() string {
	baseURL := os.Getenv("BASE_URL")	
	return sanitizeBaseURL(baseURL)
}

func GetMethodURL(baseURL string, pkg string, service string, method string) string {
	prefix := "twirp"

	fullServiceName := service
	if pkg != "" {
		fullServiceName = pkg + "." + service
	}

	return strings.TrimRight(baseURL, "/") + path.Join("/", prefix, fullServiceName, method)
}

func GetHeaders() map[string]string {
	headers := map[string]string{}
	for i := 1; i <=5; i++ {
		v := os.Getenv(fmt.Sprintf("HEADER_%d", i))
		name, value := parseHeader(v)
		if name != "" {
			headers[name] = value
		}
	}
	// Legacy. Will be deprecated
	name, value := parseHeader(os.Getenv("AUTH_HEADER"))
	if name != "" {
		headers[name] = value
	}
	return headers
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

func parseHeader(v string) (name string, value string) {
	s := strings.Split(v, ":")
	if len(s) > 0 {
		name = strings.TrimSpace(s[0])
	}
	if len(s) > 1 {
		value = strings.TrimSpace(s[1])
	}
	return name, value
}