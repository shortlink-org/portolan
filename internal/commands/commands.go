// Package commands reads what a developer types against a checkout - the make
// targets, npm scripts, just recipes and task-runner tasks a repository
// declares - into catalog.Command values.
//
// It reads the runner files and nothing else. A README that says "run make
// test" is a claim; a Makefile with a test target is the fact, and the two
// drift apart exactly when the README stops being read. Every parser here is
// deliberately shallow: it knows the file well enough to list its entries and
// their descriptions, and it does not evaluate anything. A make target hidden
// behind an `ifeq` is listed; a target spelled through a variable is not,
// because the name it would have depends on a value nobody here can know.
package commands

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// Read lists the commands declared at root, in a fixed order of files - make,
// just, Taskfile, the package manifest, pyproject, pom, the Gradle script,
// cargo's aliases - and in file order inside each. Source is spelled root-relative with the line, the way the rest of the
// catalog spells one.
//
// Warnings name what was seen and not read: a Taskfile that is not YAML, a
// package.json whose scripts are not an object.
func Read(root string) ([]catalog.Command, []string) {
	var out []catalog.Command
	var warnings []string

	add := func(cmds []catalog.Command, warns []string) {
		out = append(out, cmds...)
		warnings = append(warnings, warns...)
	}

	if file, src, ok := first(root, "Makefile", "makefile", "GNUmakefile"); ok {
		add(readMakefile(file, src), nil)
	}
	if file, src, ok := first(root, "justfile", "Justfile", ".justfile"); ok {
		add(readJustfile(file, src), nil)
	}
	if file, src, ok := first(root, "Taskfile.yml", "Taskfile.yaml", "taskfile.yml", "taskfile.yaml", "Taskfile.dist.yml", "Taskfile.dist.yaml"); ok {
		add(readTaskfile(file, src))
	}
	if file, src, ok := first(root, "package.json"); ok {
		add(readPackageJSON(file, src, nodeRunner(root)))
	}
	if file, src, ok := first(root, "pyproject.toml"); ok {
		add(readPyproject(file, src), nil)
	}
	if file, src, ok := first(root, "pom.xml"); ok {
		add(readPom(root, file, src), nil)
	}
	if file, src, ok := first(root, "build.gradle.kts", "build.gradle"); ok {
		add(readGradle(root, file, src), nil)
	}
	if file, src, ok := first(root, ".cargo/config.toml", ".cargo/config"); ok {
		add(readCargoAliases(root, file, src), nil)
	}

	return out, warnings
}

// first opens the first of names that exists under root, answering its
// root-relative path and contents.
func first(root string, names ...string) (string, string, bool) {
	for _, name := range names {
		raw, err := os.ReadFile(filepath.Join(root, name))
		if err != nil {
			continue
		}

		return filepath.ToSlash(filepath.Join(root, name)), string(raw), true
	}

	return "", "", false
}

// nodeRunner is the package manager a checkout is set up for, read off the
// lockfile it keeps - the one file that says which tool the last person used.
func nodeRunner(root string) string {
	for _, lock := range []struct{ file, runner string }{
		{"pnpm-lock.yaml", "pnpm"},
		{"yarn.lock", "yarn"},
		{"bun.lockb", "bun"},
		{"bun.lock", "bun"},
	} {
		if _, err := os.Stat(filepath.Join(root, lock.file)); err == nil {
			return lock.runner
		}
	}

	return "npm"
}

func at(file string, line int) string {
	return file + ":" + strconv.Itoa(line)
}

// hooks drops the pre/post entries of a name that is itself listed, the way
// npm and pdm run them: `pretest` is part of `test`, not a second command.
func hooks(cmds []catalog.Command, prefixes ...string) []catalog.Command {
	named := map[string]bool{}
	for _, cmd := range cmds {
		named[cmd.Name] = true
	}
	kept := cmds[:0]
	for _, cmd := range cmds {
		hook := false
		for _, prefix := range prefixes {
			if rest, ok := strings.CutPrefix(cmd.Name, prefix); ok && rest != "" && named[rest] {
				hook = true
			}
		}
		if !hook {
			kept = append(kept, cmd)
		}
	}

	return kept
}

// commentAbove is the contiguous block of `#` lines ending at line i-1, as one
// paragraph, or "" when the line above is not a comment. A blank line breaks
// the block: a comment two lines up is about something else.
func commentAbove(lines []string, i int, marker string) string {
	var block []string
	for j := i - 1; j >= 0; j-- {
		text := strings.TrimSpace(lines[j])
		if !strings.HasPrefix(text, marker) {
			break
		}
		text = strings.TrimSpace(strings.TrimPrefix(text, marker))
		// A `## help` line in a block is help; a `##` divider is not a word.
		text = strings.TrimSpace(strings.TrimLeft(text, "#"))
		block = append([]string{text}, block...)
	}

	return strings.TrimSpace(strings.Join(block, " "))
}
