package bundle

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// Bundle is an opened bundle: its manifest, and the files behind it.
type Bundle struct {
	Manifest *Manifest

	reader *zip.Reader
	closer io.Closer
}

// Open reads a bundle from a file.
func Open(name string) (*Bundle, error) {
	file, err := os.Open(name)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	bundle, err := read(file, info.Size(), file)
	if err != nil {
		file.Close()
		return nil, fmt.Errorf("%s: %w", name, err)
	}
	return bundle, nil
}

// OpenSelf reads a bundle appended to the running executable, which is what
// makes an exported app one file rather than two. Nothing is compiled to
// produce one: the runner is the same bytes for every export, and the bundle is
// data after it. A zip's directory is at the end and its offsets are relative,
// so a reader steps over whatever precedes it — which here is a whole program.
//
// It reports (nil, nil) when the executable carries no bundle, since a runner
// invoked with a path on the command line is the ordinary other case rather
// than a failure.
func OpenSelf() (*Bundle, error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, nil
	}
	if resolved, err := filepath.EvalSymlinks(executable); err == nil {
		executable = resolved
	}
	file, err := os.Open(executable)
	if err != nil {
		return nil, nil
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, nil
	}
	bundle, err := read(file, info.Size(), file)
	if err != nil {
		file.Close()
		// An executable with nothing appended is not a broken bundle.
		return nil, nil
	}
	return bundle, nil
}

// Read reads a bundle from anything addressable, which is what a test has.
func Read(reader io.ReaderAt, size int64) (*Bundle, error) {
	return read(reader, size, nil)
}

func read(reader io.ReaderAt, size int64, closer io.Closer) (*Bundle, error) {
	zipReader, err := zip.NewReader(reader, size)
	if err != nil {
		return nil, err
	}

	file, err := zipReader.Open(ManifestName)
	if err != nil {
		return nil, fmt.Errorf("not a kaja bundle: no %s", ManifestName)
	}
	defer file.Close()

	manifest := &Manifest{}
	if err := json.NewDecoder(file).Decode(manifest); err != nil {
		return nil, fmt.Errorf("reading %s: %w", ManifestName, err)
	}
	// A later format may mean anything at all, including a manifest field this
	// build would silently ignore. Refusing names the version, which is the one
	// thing the person holding the file can act on.
	if manifest.FormatVersion > FormatVersion {
		return nil, fmt.Errorf("bundle is format version %d, this build reads %d — export it again, or update kaja", manifest.FormatVersion, FormatVersion)
	}

	return &Bundle{Manifest: manifest, reader: zipReader, closer: closer}, nil
}

// ReadFile reads one entry.
func (b *Bundle) ReadFile(name string) ([]byte, error) {
	file, err := b.reader.Open(name)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return io.ReadAll(file)
}

// FS is the bundle's contents as a file system, for serving them directly.
func (b *Bundle) FS() fs.FS {
	return b.reader
}

// Extract writes the entries under prefix into dir, keeping their layout. The
// apps read their proto surface as files on disk, so the frozen surface is put
// back on disk rather than every app being taught to read a zip.
func (b *Bundle) Extract(prefix string, dir string) error {
	for _, file := range b.reader.File {
		if file.FileInfo().IsDir() || !strings.HasPrefix(file.Name, prefix) {
			continue
		}
		// The name comes out of a file somebody else may have written, so it is
		// checked rather than joined: an entry naming its way out of the directory
		// is the oldest trick there is.
		relative := strings.TrimPrefix(file.Name, prefix)
		relative = strings.TrimPrefix(relative, "/")
		if relative == "" {
			continue
		}
		if !fs.ValidPath(path.Clean(relative)) || strings.HasPrefix(relative, "../") {
			return fmt.Errorf("bundle entry %q is not a valid path", file.Name)
		}
		target := filepath.Join(dir, filepath.FromSlash(path.Clean(relative)))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		source, err := file.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(target)
		if err != nil {
			source.Close()
			return err
		}
		_, err = io.Copy(out, source)
		source.Close()
		out.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

// Close releases the file the bundle was read from, if it owns one.
func (b *Bundle) Close() error {
	if b.closer != nil {
		return b.closer.Close()
	}
	return nil
}

// Writer writes a bundle.
type Writer struct {
	zip    *zip.Writer
	closer io.Closer
}

// Create starts a bundle at name.
func Create(name string) (*Writer, error) {
	file, err := os.Create(name)
	if err != nil {
		return nil, err
	}
	return &Writer{zip: zip.NewWriter(file), closer: file}, nil
}

// NewWriter writes a bundle to w.
func NewWriter(w io.Writer) *Writer {
	return &Writer{zip: zip.NewWriter(w)}
}

// Add writes one entry.
func (w *Writer) Add(name string, content []byte) error {
	entry, err := w.zip.Create(name)
	if err != nil {
		return err
	}
	_, err = entry.Write(content)
	return err
}

// AddManifest writes the manifest, stamping the format version so no caller has
// to remember to.
func (w *Writer) AddManifest(manifest *Manifest) error {
	manifest.FormatVersion = FormatVersion
	content, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	return w.Add(ManifestName, content)
}

// AddDir writes a directory tree under prefix.
func (w *Writer) AddDir(dir string, prefix string) error {
	return filepath.Walk(dir, func(name string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(dir, name)
		if err != nil {
			return err
		}
		content, err := os.ReadFile(name)
		if err != nil {
			return err
		}
		return w.Add(path.Join(prefix, filepath.ToSlash(relative)), content)
	})
}

// Close finishes the bundle.
func (w *Writer) Close() error {
	if err := w.zip.Close(); err != nil {
		if w.closer != nil {
			w.closer.Close()
		}
		return err
	}
	if w.closer != nil {
		return w.closer.Close()
	}
	return nil
}

// AppendTo copies runner to out and appends bundlePath to it, producing the one
// file an exported app is. Nothing is compiled: the runner is prebuilt for its
// platform and the bundle is data, so this is a copy and a concatenation
// whatever the target is.
//
// The result is unsigned. A file produced here carries no quarantine bit, so it
// runs on the machine that made it; sending it to another Mac is what asks for
// a signature, and that is a question about distribution rather than about
// export.
func AppendTo(runner string, bundlePath string, out string) error {
	source, err := os.Open(runner)
	if err != nil {
		return fmt.Errorf("reading runner: %w", err)
	}
	defer source.Close()

	target, err := os.OpenFile(out, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	defer target.Close()

	if _, err := io.Copy(target, source); err != nil {
		return err
	}

	appended, err := os.Open(bundlePath)
	if err != nil {
		return err
	}
	defer appended.Close()

	if _, err := io.Copy(target, appended); err != nil {
		return err
	}
	return target.Sync()
}
