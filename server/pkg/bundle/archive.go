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
//
// A bundle arrives from wherever it arrived from — it is made to be handed
// around — so every entry is treated as a name somebody else chose. The
// containment is checked twice and in the two ways that can each be wrong on
// their own: the name is refused unless it is a local, relative path, and the
// joined result is refused unless it is still inside dir. The second is what
// holds when the first is fooled, which is the whole history of this class of
// bug.
func (b *Bundle) Extract(prefix string, dir string) error {
	root, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return err
	}

	for _, file := range b.reader.File {
		if file.FileInfo().IsDir() || !strings.HasPrefix(file.Name, prefix) {
			continue
		}
		relative := strings.TrimPrefix(strings.TrimPrefix(file.Name, prefix), "/")
		if relative == "" {
			continue
		}
		target, err := containedPath(root, relative)
		if err != nil {
			return fmt.Errorf("bundle entry %q: %w", file.Name, err)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		if err := writeEntry(file, target); err != nil {
			return err
		}
	}
	return nil
}

// containedPath resolves one archive entry's name inside root, and refuses
// anything that does not stay there.
func containedPath(root string, name string) (string, error) {
	cleaned := path.Clean(name)
	// filepath.IsLocal rejects absolute paths, "..", and anything that would
	// climb out; fs.ValidPath rules out the shapes a zip is allowed to hold but
	// a file name is not.
	if !fs.ValidPath(cleaned) || !filepath.IsLocal(filepath.FromSlash(cleaned)) {
		return "", fmt.Errorf("is not a path inside the bundle")
	}
	target := filepath.Join(root, filepath.FromSlash(cleaned))
	// And the answer itself is checked, rather than the name it was derived from.
	inside, err := filepath.Rel(root, target)
	if err != nil || inside == ".." || strings.HasPrefix(inside, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("would be written outside the destination")
	}
	return target, nil
}

func writeEntry(file *zip.File, target string) error {
	source, err := file.Open()
	if err != nil {
		return err
	}
	defer source.Close()

	out, err := os.Create(target)
	if err != nil {
		return err
	}
	defer out.Close()

	// A bundle is made here and read here, so an entry claiming to be a gigabyte
	// is a bundle that was tampered with rather than one that is merely large.
	if _, err := io.Copy(out, io.LimitReader(source, maxEntrySize)); err != nil {
		return err
	}
	return nil
}

// maxEntrySize is what one entry may unpack to. The largest thing a bundle
// legitimately holds is the stub, which is a few hundred kilobytes for a big
// API.
const maxEntrySize = 64 << 20

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
