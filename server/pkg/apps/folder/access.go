package folder

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/user"
	"path/filepath"
	"strings"
)

// ProblemKind says why a folder can't be opened, which decides what fixes it.
type ProblemKind int

const (
	// Missing is a path nothing is at.
	Missing ProblemKind = iota + 1
	// NotAFolder is a path a file is at.
	NotAFolder
	// Refused is a folder the process may not read. On the sandboxed desktop that is
	// a folder nobody picked, since picking it is what grants access.
	Refused
)

// Problem is a folder the app could not open, said as a sentence.
type Problem struct {
	Kind    ProblemKind
	Message string
}

func (p *Problem) Error() string { return p.Message }

// Resolve is the folder a path names as the app opens it: `~` is the person's home.
// os/user rather than $HOME, because the sandbox points $HOME at kaja's own container.
func Resolve(path string) string {
	path = strings.TrimSpace(path)
	if path == "~" || strings.HasPrefix(path, "~/") {
		if home := homeDir(); home != "" {
			path = filepath.Join(home, path[1:])
		}
	}
	if path == "" {
		return ""
	}
	return filepath.Clean(path)
}

func homeDir() string {
	if u, err := user.Current(); err == nil && u.HomeDir != "" {
		return u.HomeDir
	}
	home, _ := os.UserHomeDir()
	return home
}

// Check reads the folder the way a call would. A stat alone is not enough: the
// sandbox can answer one for a folder it refuses to list.
func Check(path string) *Problem {
	f, err := os.Open(path)
	if err == nil {
		defer f.Close()
		var info fs.FileInfo
		if info, err = f.Stat(); err == nil && !info.IsDir() {
			return &Problem{Kind: NotAFolder, Message: fmt.Sprintf("%s is a file, not a folder.", path)}
		}
		if err == nil {
			if _, err = f.Readdirnames(1); errors.Is(err, io.EOF) {
				err = nil
			}
		}
	}
	switch {
	case err == nil:
		return nil
	case errors.Is(err, fs.ErrNotExist):
		return &Problem{Kind: Missing, Message: fmt.Sprintf("There is no folder at %s.", path)}
	case errors.Is(err, fs.ErrPermission):
		return &Problem{Kind: Refused, Message: fmt.Sprintf("Kaja has no access to %s. Picking the folder in the app's settings is what grants it.", path)}
	default:
		return &Problem{Kind: Refused, Message: fmt.Sprintf("Kaja can't read %s: %v.", path, err)}
	}
}
