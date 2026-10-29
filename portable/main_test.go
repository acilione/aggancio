package main

import (
	"archive/zip"
	"bytes"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestLocalServerBoundaries(t *testing.T) {
	stopped := false
	files := fstest.MapFS{"index.html": {Data: []byte("<html><body>Commons</body></html>")}, "assets/worker.js": {Data: []byte("self.onmessage=()=>{};")}, "ocr/engine.wasm": {Data: []byte{0, 97, 115, 109}}}
	handler := newHandler(files, "http://127.0.0.1:4173", "secret", func() { stopped = true })
	tests := []struct {
		name, method, path, host, origin, token string
		status                                  int
	}{
		{"homepage", "GET", "/", "127.0.0.1:4173", "", "", 200},
		{"worker", "GET", "/assets/worker.js", "127.0.0.1:4173", "", "", 200},
		{"wasm", "GET", "/ocr/engine.wasm", "127.0.0.1:4173", "", "", 200},
		{"missing", "GET", "/no-such-file", "127.0.0.1:4173", "", "", 404},
		{"traversal", "GET", "/../go.mod", "127.0.0.1:4173", "", "", 404},
		{"rebound host", "GET", "/", "attacker.example:4173", "", "", 403},
		{"foreign origin", "GET", "/", "127.0.0.1:4173", "https://attacker.example", "", 403},
		{"quit needs post", "GET", "/_commons/quit", "127.0.0.1:4173", "", "secret", 405},
		{"quit needs token", "POST", "/_commons/quit", "127.0.0.1:4173", "", "", 403},
		{"cross-origin quit", "POST", "/_commons/quit", "127.0.0.1:4173", "http://localhost:4173", "secret", 403},
		{"no writes", "POST", "/index.html", "127.0.0.1:4173", "", "", 405},
		{"quit", "POST", "/_commons/quit", "127.0.0.1:4173", "http://127.0.0.1:4173", "secret", 204},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, "http://"+test.host+test.path, nil)
			request.Header.Set("Origin", test.origin)
			request.Header.Set("X-Commons-Token", test.token)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != test.status {
				t.Fatalf("got %d, want %d", response.Code, test.status)
			}
			if test.name == "homepage" && !strings.Contains(response.Body.String(), `src="/_commons/client.js"`) {
				t.Fatal("missing launcher control")
			}
			if test.name == "worker" && !strings.HasPrefix(response.Header().Get("Content-Type"), "text/javascript") {
				t.Fatal("incorrect worker MIME type")
			}
			if test.name == "wasm" && response.Header().Get("Content-Type") != "application/wasm" {
				t.Fatal("incorrect WebAssembly MIME type")
			}
			if test.name != "quit" && stopped {
				t.Fatal("server stopped without authorized quit")
			}
		})
	}
	if !stopped {
		t.Fatal("quit did not stop server")
	}
}

func TestEmbeddedWebsite(t *testing.T) {
	files, err := zip.NewReader(bytes.NewReader(site), int64(len(site)))
	if err != nil {
		t.Fatal(err)
	}
	index, err := fs.ReadFile(files, "index.html")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(index, []byte("/assets/")) {
		t.Fatal("built frontend missing")
	}
	for _, name := range []string{"THIRD-PARTY-NOTICES.txt", "README.md"} {
		if _, err := fs.ReadFile(files, name); err != nil {
			t.Fatal(err)
		}
	}
	handler := newHandler(files, "http://127.0.0.1:4173", "token", func() {})
	found := false
	for _, file := range files.File {
		if !strings.HasSuffix(file.Name, ".wasm") {
			continue
		}
		found = true
		request := httptest.NewRequest("GET", "http://127.0.0.1:4173/"+file.Name, nil)
		request.Header.Set("Range", "bytes=0-3")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusPartialContent || !bytes.Equal(response.Body.Bytes(), []byte{0, 97, 115, 109}) {
			t.Fatal("embedded WebAssembly/range serving failed")
		}
		break
	}
	if !found {
		t.Fatal("OCR WebAssembly missing from bundle")
	}
}

func TestExistingInstance(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(`{"app":"` + appID + `"}`)) }))
	defer server.Close()
	if !existingApp(server.URL) {
		t.Fatal("failed to identify running instance")
	}
	unrelated := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("another application")) }))
	defer unrelated.Close()
	if existingApp(unrelated.URL) {
		t.Fatal("accepted unrelated process on port")
	}
}
