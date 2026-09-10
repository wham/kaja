package main

import (
	"fmt"
	"os"
)

// A folder that isn't there is refused rather than created: an unplugged disk's mount
// point is a path that looks writable, and scripts written there are ones the disk
// coming back would hide.
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
