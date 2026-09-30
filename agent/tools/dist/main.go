// Command dist cross-compiles the agent for Windows and macOS into agent/dist.
//
//	go run ./tools/dist [-version 1.0.0] [-out dist]
//
// macOS builds are zipped so the executable bit survives a browser download.
package main

import (
	"archive/zip"
	"crypto/sha256"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type target struct{ goos, goarch, name string }

var targets = []target{
	{"windows", "amd64", "peoplehub-agent-windows-amd64.exe"},
	{"windows", "arm64", "peoplehub-agent-windows-arm64.exe"},
	{"darwin", "arm64", "peoplehub-agent-macos-arm64"},
	{"darwin", "amd64", "peoplehub-agent-macos-amd64"},
}

func main() {
	version := flag.String("version", "1.0.0", "version stamped into the binaries")
	out := flag.String("out", "dist", "output directory")
	flag.Parse()
	if err := os.MkdirAll(*out, 0o755); err != nil {
		fail(err)
	}
	var files []string
	for _, t := range targets {
		ldflags := "-s -w -X main.version=" + *version
		if t.goos == "windows" {
			ldflags += " -H=windowsgui" // no console window at login; commands attach to the parent terminal
		}
		bin := filepath.Join(*out, t.name)
		cmd := exec.Command("go", "build", "-trimpath", "-ldflags", ldflags, "-o", bin, ".")
		cmd.Env = append(os.Environ(), "GOOS="+t.goos, "GOARCH="+t.goarch, "CGO_ENABLED=0")
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		fmt.Printf("building %s/%s\n", t.goos, t.goarch)
		if err := cmd.Run(); err != nil {
			fail(err)
		}
		if t.goos == "darwin" {
			z := bin + ".zip"
			if err := zipOne(z, bin, "peoplehub-agent"); err != nil {
				fail(err)
			}
			os.Remove(bin)
			bin = z
		}
		files = append(files, bin)
	}
	sort.Strings(files)
	var sums strings.Builder
	for _, f := range files {
		sum, err := hashFile(f)
		if err != nil {
			fail(err)
		}
		st, _ := os.Stat(f)
		fmt.Fprintf(&sums, "%s  %s\n", sum, filepath.Base(f))
		fmt.Printf("  %-36s %6.1f MB\n", filepath.Base(f), float64(st.Size())/1e6)
	}
	must(os.WriteFile(filepath.Join(*out, "SHA256SUMS"), []byte(sums.String()), 0o644))
	must(os.WriteFile(filepath.Join(*out, "VERSION"), []byte(*version+"\n"), 0o644))
	fmt.Printf("agent %s built into %s\n", *version, *out)
}

func zipOne(dst, src, name string) error {
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer f.Close()
	zw := zip.NewWriter(f)
	h := &zip.FileHeader{Name: name, Method: zip.Deflate, Modified: time.Now()}
	h.SetMode(0o755)
	w, err := zw.CreateHeader(h)
	if err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if _, err := io.Copy(w, in); err != nil {
		return err
	}
	return zw.Close()
}

func hashFile(p string) (string, error) {
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}

func must(err error) {
	if err != nil {
		fail(err)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "build failed:", err)
	os.Exit(1)
}
