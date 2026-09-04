package main

// The only file that runs git.
//
// The host already needs a git binary to stamp fragments, so this leans on
// the same one rather than on a library: whatever git is configured to do
// about credentials and hosts, it does here too, and this plugin has no
// opinion about it. Everything happens in a directory that exists for one
// call: a fetch of the one commit, and an archive of the paths wanted, read
// straight into memory.

import (
	"archive/tar"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"strings"
)

// splitRepo turns the name the manifest uses into a URL git can fetch and
// the directory the copy lives in: owner/name, the same shape as fetch-bsr.
func splitRepo(name string) (url, dir string, err error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", "", fmt.Errorf("a repo entry names no repository")
	}

	var where string
	switch {
	case strings.HasPrefix(name, "git@"):
		// git@host:owner/name
		url = name
		_, where, _ = strings.Cut(name, ":")
	case strings.Contains(name, "://"):
		url = name
		_, where, _ = strings.Cut(name, "://")
		if i := strings.Index(where, "/"); i >= 0 {
			where = where[i+1:]
		}
	default:
		// host/owner/name, the way go.mod spells it.
		url = "https://" + name
		if i := strings.Index(name, "/"); i >= 0 {
			where = name[i+1:]
		}
	}

	where = strings.TrimSuffix(strings.Trim(where, "/"), ".git")
	segments := strings.Split(where, "/")
	if len(segments) < 2 {
		return "", "", fmt.Errorf("%q does not name an owner and a repository", name)
	}
	dir = path.Join(segments[len(segments)-2], segments[len(segments)-1])

	return url, dir, nil
}

// git runs one command and answers with its output, or with what it printed
// on stderr when it failed. Prompts are off: a fetch that needs a credential
// git does not have is a failure to report, not a question to hang on.
func git(dir string, args ...string) ([]byte, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}

		return nil, errors.New("git " + args[0] + ": " + firstLine(msg))
	}

	return out, nil
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}

	return s
}

// resolve asks the remote what a ref points at right now.
func resolve(url, ref string) (string, error) {
	args := []string{"ls-remote", "--quiet", url}
	if ref != "" {
		args = append(args, ref)
	} else {
		args = append(args, "HEAD")
	}
	out, err := git("", args...)
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 1 && len(fields[0]) == 40 {
			return fields[0], nil
		}
	}

	return "", fmt.Errorf("%s has no ref %q", url, firstNonEmpty(ref, "HEAD"))
}

// download fetches one commit and reads the wanted paths out of it.
//
// The commit is fetched by name where the forge allows it - GitHub and GitLab
// do - and by its branches where it does not, which is the case for a plain
// file:// remote; either way what is read is verified to be that commit.
func download(url, commit string, paths []string) (map[string][]byte, error) {
	tmp, err := os.MkdirTemp("", "portolan-fetch-git-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)

	if _, err := git(tmp, "init", "--quiet"); err != nil {
		return nil, err
	}
	if _, err := git(tmp, "fetch", "--quiet", "--depth", "1", url, commit); err != nil {
		if _, fallback := git(tmp, "fetch", "--quiet", "--depth", "1", url, "+refs/heads/*:refs/remotes/src/*"); fallback != nil {
			return nil, err
		}
	}
	if _, err := git(tmp, "cat-file", "-e", commit+"^{commit}"); err != nil {
		return nil, fmt.Errorf("%s is not a commit %s has, or not one reachable from a branch", commit, url)
	}

	args := []string{"archive", "--format=tar", commit}
	if len(paths) > 0 {
		args = append(args, "--")
		args = append(args, paths...)
	}
	archive, err := git(tmp, args...)
	if err != nil {
		return nil, err
	}

	files := map[string][]byte{}
	reader := tar.NewReader(bytes.NewReader(archive))
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		content, err := io.ReadAll(reader)
		if err != nil {
			return nil, err
		}
		files[path.Clean(header.Name)] = content
	}

	return files, nil
}
