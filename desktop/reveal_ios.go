//go:build ios

package main

// There is no file browser to open on iOS, and the fallback the other
// platforms share would spawn one. A sandbox with no Finder in front of it is
// nothing to reveal a path in.

func revealInFinder(path string) {}

func revealFileInFinder(path string) {}
