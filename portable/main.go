package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path"
	"runtime"
	"strings"
	"time"
)

//go:embed site.zip
var site []byte

//go:embed client.js
var clientJS string

var version = "dev"

const appID = "commons-events-portable-v1"

func main() {
	if err := run(); err != nil {
		notifyError(err.Error())
		os.Exit(1)
	}
}

func run() error {
	port := flag.Int("port", 4173, "Local port (keep the default to retain access to browser drafts)")
	noBrowser := flag.Bool("no-browser", false, "Run without opening a browser")
	showVersion := flag.Bool("version", false, "Print the bundled version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return nil
	}
	if *port < 0 || *port > 65535 {
		return errors.New("port must be between 0 and 65535")
	}
	address := fmt.Sprintf("127.0.0.1:%d", *port)
	listener, err := net.Listen("tcp4", address)
	if err != nil {
		origin := "http://" + address
		if existingApp(origin) {
			fmt.Println("Commons is already running at", origin)
			if !*noBrowser {
				return openBrowser(origin)
			}
			return nil
		}
		return fmt.Errorf("could not start Commons at %s: %w. Close the application using that port and try again. The port is kept fixed so your browser can find your saved drafts", origin, err)
	}
	defer listener.Close()
	origin := "http://" + listener.Addr().String()
	files, err := zip.NewReader(bytes.NewReader(site), int64(len(site)))
	if err != nil {
		return err
	}
	random := make([]byte, 32)
	if _, err := rand.Read(random); err != nil {
		return err
	}
	token := hex.EncodeToString(random)
	stop, cancel := context.WithCancel(context.Background())
	defer cancel()
	server := &http.Server{Handler: newHandler(files, origin, token, cancel), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	finished := make(chan error, 1)
	go func() { finished <- server.Serve(listener) }()
	fmt.Println("Commons:", origin)
	fmt.Println("Use Quit local app at the bottom of the website to stop the server.")
	if !*noBrowser {
		if err := openBrowser(origin); err != nil {
			notifyError(fmt.Sprintf("Commons is running. Open %s in your browser. Automatic browser opening failed: %v", origin, err))
		}
	}
	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt)
	defer signal.Stop(interrupt)
	select {
	case <-stop.Done():
	case <-interrupt:
	case err := <-finished:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	}
	ctx, cleanup := context.WithTimeout(context.Background(), 3*time.Second)
	defer cleanup()
	return server.Shutdown(ctx)
}

func existingApp(origin string) bool {
	client := &http.Client{Timeout: time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Get(origin + "/_commons/status")
	if err != nil {
		return false
	}
	defer response.Body.Close()
	var status struct {
		App string `json:"app"`
	}
	return response.StatusCode == http.StatusOK && json.NewDecoder(http.MaxBytesReader(nil, response.Body, 1024)).Decode(&status) == nil && status.App == appID
}

func newHandler(files fs.FS, origin, token string, quit func()) http.Handler {
	host := strings.TrimPrefix(origin, "http://")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Reject other origins and Host headers, including DNS rebinding requests.
		if r.Host != host || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != origin) || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			http.Error(w, "Local access only", http.StatusForbidden)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.Path == "/_commons/quit" {
			if r.Method != http.MethodPost {
				w.Header().Set("Allow", "POST")
				http.Error(w, "POST required", http.StatusMethodNotAllowed)
				return
			}
			if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Commons-Token")), []byte(token)) != 1 {
				http.Error(w, "Invalid launcher token", http.StatusForbidden)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			quit()
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		switch r.URL.Path {
		case "/_commons/status":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]string{"app": appID, "version": version})
			return
		case "/_commons/client.js":
			w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
			encoded, _ := json.Marshal(token)
			http.ServeContent(w, r, "client.js", time.Time{}, strings.NewReader(strings.ReplaceAll(clientJS, "__COMMONS_TOKEN__", string(encoded))))
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		if !fs.ValidPath(name) {
			http.NotFound(w, r)
			return
		}
		data, err := fs.ReadFile(files, name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if name == "index.html" {
			data = bytes.Replace(data, []byte("</body>"), []byte(`<script src="/_commons/client.js" defer></script></body>`), 1)
		}
		types := map[string]string{".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".wasm": "application/wasm", ".json": "application/json"}
		contentType := types[path.Ext(name)]
		if contentType == "" {
			contentType = mime.TypeByExtension(path.Ext(name))
		}
		if contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		if strings.HasPrefix(name, "assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(data))
	})
}

func openBrowser(url string) error {
	var command *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		command = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		command = exec.Command("open", url)
	default:
		command = exec.Command("xdg-open", url)
	}
	if err := command.Start(); err != nil {
		return err
	}
	go command.Wait()
	return nil
}
