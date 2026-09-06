package commands

import (
	"encoding/json"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// readPackageJSON lists the scripts of a package manifest, in the order the
// file lists them, because the author put `build` before `deploy` for a
// reason and a sorted list would lose it. `pre` and `post` hooks of a listed
// script are folded into it, the way the runner runs them. The line to type
// is the runner's: npm keeps `start`, `test`, `stop` and `restart` as
// commands of their own, and a checkout with a pnpm or yarn lockfile is
// typed at that tool instead.
func readPackageJSON(file, src, runner string) ([]catalog.Command, []string) {
	scripts, lines, err := packageScripts(src)
	if err != nil {
		return nil, []string{file + ": " + err.Error()}
	}

	out := make([]catalog.Command, 0, len(scripts))
	for _, script := range scripts {
		out = append(out, catalog.Command{
			Runner: runner,
			Name:   script.name,
			Run:    runLine(runner, script.name),
			Body:   script.body,
			Source: at(file, lines[script.name]),
		})
	}

	return hooks(out, "pre", "post"), nil
}

type script struct{ name, body string }

// packageScripts walks the document token by token, which is the one way
// encoding/json will give back an object's keys in file order.
func packageScripts(src string) ([]script, map[string]int, error) {
	dec := json.NewDecoder(strings.NewReader(src))
	tok, err := dec.Token()
	if err != nil || tok != json.Delim('{') {
		return nil, nil, wrap("not a JSON object", err)
	}
	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return nil, nil, wrap("not a JSON object", err)
		}
		key, _ := keyTok.(string)
		if key != "scripts" {
			var skip json.RawMessage
			if err := dec.Decode(&skip); err != nil {
				return nil, nil, wrap("not a JSON object", err)
			}

			continue
		}

		offset := int(dec.InputOffset())
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return nil, nil, wrap("scripts could not be read", err)
		}
		var byName map[string]string
		if err := json.Unmarshal(raw, &byName); err != nil {
			return nil, nil, wrap("scripts is not an object of strings", err)
		}
		order := keyOrder(raw)
		scripts := make([]script, 0, len(order))
		for _, name := range order {
			scripts = append(scripts, script{name: name, body: byName[name]})
		}

		return scripts, keyLines(src, offset, raw), nil
	}

	return nil, nil, nil
}

func wrap(what string, err error) error {
	if err == nil {
		return errString(what)
	}

	return errString(what + ": " + err.Error())
}

type errString string

func (e errString) Error() string { return string(e) }

// keyOrder reads the keys of a JSON object in the order they are written.
func keyOrder(raw json.RawMessage) []string {
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return nil
	}
	var keys []string
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return keys
		}
		if key, ok := tok.(string); ok {
			keys = append(keys, key)
		}
		var skip json.RawMessage
		if err := dec.Decode(&skip); err != nil {
			return keys
		}
	}

	return keys
}

// keyLines finds the line each script's key sits on. The decoder says where
// the `scripts` key ended, the object opens at the next brace, and each key's
// position inside the object is then a position in the file.
func keyLines(src string, offset int, raw json.RawMessage) map[string]int {
	lines := map[string]int{}
	brace := strings.Index(src[offset:], "{")
	if brace < 0 {
		return lines
	}
	start := offset + brace
	object := string(raw)
	for _, key := range keyOrder(raw) {
		quoted := `"` + key + `"`
		at := strings.Index(object, quoted)
		if at < 0 {
			continue
		}
		lines[key] = 1 + strings.Count(src[:start+at], "\n")
		// Blank the key so a second script whose name contains this one
		// (`build` inside `build:watch`) is not found at the first.
		object = object[:at] + strings.Repeat(" ", len(quoted)) + object[at+len(quoted):]
	}

	return lines
}

func runLine(runner, name string) string {
	switch runner {
	case "npm":
		switch name {
		case "start", "test", "stop", "restart":
			return "npm " + name
		}

		return "npm run " + name
	case "bun":
		return "bun run " + name
	}

	return runner + " " + name
}
