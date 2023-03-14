package client

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGetBaseURL(t *testing.T) {
	t.Setenv("BASE_URL", "")
	assert.Equal(t, "http:", GetBaseURL())

	t.Setenv("BASE_URL", "localhost")
	assert.Equal(t, "http://localhost", GetBaseURL())

	t.Setenv("BASE_URL", "localhost:8080")
	assert.Equal(t, "localhost:8080", GetBaseURL())

	t.Setenv("BASE_URL", "localhost:8080/")
	assert.Equal(t, "localhost:8080/", GetBaseURL())

	t.Setenv("BASE_URL", "http://localhost")
	assert.Equal(t, "http://localhost", GetBaseURL())

	t.Setenv("BASE_URL", "http://localhost/")
	assert.Equal(t, "http://localhost/", GetBaseURL())

	t.Setenv("BASE_URL", "http://localhost:8080")
	assert.Equal(t, "http://localhost:8080", GetBaseURL())

	t.Setenv("BASE_URL", "https://localhost:8080")
	assert.Equal(t, "https://localhost:8080", GetBaseURL())

	t.Setenv("BASE_URL", "kaja.tools/demo")
	assert.Equal(t, "http://kaja.tools/demo", GetBaseURL())

	t.Setenv("BASE_URL", "127.0.0.1")
	assert.Equal(t, "http://127.0.0.1", GetBaseURL())

	t.Setenv("BASE_URL", "https://127.0.0.1")
	assert.Equal(t, "https://127.0.0.1", GetBaseURL())

	t.Setenv("BASE_URL", "http://host.docker.internal:8080")
	assert.Equal(t, "http://host.docker.internal:8080", GetBaseURL())
}

func TestGetMethodURL(t *testing.T) {
	assert.Equal(t, "https://localhost/twirp/Search/Index", GetMethodURL("https://localhost", "", "Search", "Index"))
	assert.Equal(t, "https://localhost/twirp/Search/Index", GetMethodURL("https://localhost/", "", "Search", "Index"))
	assert.Equal(t, "https://localhost:8080/twirp/Search/Index", GetMethodURL("https://localhost:8080/", "", "Search", "Index"))
	assert.Equal(t, "https://localhost:8080/twirp/v1.Search/Index", GetMethodURL("https://localhost:8080/", "v1", "Search", "Index"))
	assert.Equal(t, "https://localhost:8080/twirp", GetMethodURL("https://localhost:8080/", "", "", ""))
	assert.Equal(t, "https://localhost:8080/twirp", GetMethodURL("https://localhost:8080/", "", "/", ""))
}

func TestGetHeaders(t *testing.T) {
	assert.Equal(t, map[string]string{}, GetHeaders())

	t.Setenv("HEADER_1", "Authorization: Bearer secret123")
	t.Setenv("HEADER_3", "Authorization:Bearer secret456 ")
	t.Setenv("AUTH_HEADER", "X-Token abc")
	expected := map[string]string{
		"Authorization": "Bearer secret456",
		"X-Token abc": "",
	}
	assert.Equal(t, expected, GetHeaders())
}