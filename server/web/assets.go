package web

import _ "embed"

//go:embed favicon.svg
var FaviconSvg []byte

//go:embed index.html
var IndexHtml string

//go:embed assets/kaja-twirp.js
var KajaTwirpJs []byte