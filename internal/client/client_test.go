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