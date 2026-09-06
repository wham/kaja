package main

import (
	"fmt"
	"os"
)

// Scripts are ordinary .ts files, so pointing kaja at a folder the machine already
// syncs - a folder in iCloud Drive, a Git checkout - is how two installations come to
// be looking at the same ones, without kaja running a server or holding an account of
// its own. Only the folder moves: kaja.json stays in the container, so the apps a
// script imports are there on every launch and nothing has to be set up twice.
//
// The folder is named in kaja.json (`scripts_folder`) and resolved there; what stays in
// the container is the sandbox bookmark, because a path is a string and access is not.
// The picker is what mints one, which is why the whole verb is the desktop's.

// readableFolder refuses a folder that isn't there rather than creating it: an
// unplugged disk's mount point is a path that looks writable, and scripts written there
// are ones the disk coming back would hide.
func readableFolder(dir string) error {
	info, err := os.Stat(dir)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("%s is not a folder", dir)
	}
	return nil
}
