package commands

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

var cargoAliasTable = regexp.MustCompile(`(?m)^\[alias\]\s*$`)
var xtaskArm = regexp.MustCompile(`(?m)^[ \t]*(?:Some\()?"[a-z][a-z0-9-]*"\)?[ \t]*(?:\|[ \t]*(?:Some\()?"[a-z][a-z0-9-]*"\)?[ \t]*)*=>`)
var xtaskLiteral = regexp.MustCompile(`"([a-z][a-z0-9-]*)"`)
var xtaskVariant = regexp.MustCompile(`^[ \t]*([A-Z][A-Za-z0-9]*)\s*(?:\{[^}]*\}|\([^)]*\))?\s*,?\s*$`)
var xtaskEnum = regexp.MustCompile(`(?s)#\[derive\([^)]*Subcommand[^)]*\)\][^{]*\benum\s+\w+\s*\{(.*?)\n\}`)

// readCargoAliases lists the aliases a checkout gives cargo in
// `.cargo/config.toml`. An alias is the one place a Cargo project declares a
// command of its own - `cargo xtask`, `cargo gen` - and its expansion is the
// body. When an alias runs the `xtask` package, that package's subcommands
// are listed under it as well, because `cargo xtask` on its own does nothing.
func readCargoAliases(root, file, src string) []catalog.Command {
	loc := cargoAliasTable.FindStringIndex(src)
	if loc == nil {
		return nil
	}
	lines := strings.Split(src, "\n")
	start := strings.Count(src[:loc[0]], "\n") + 1

	var out []catalog.Command
	for i := start; i < len(lines); i++ {
		text := strings.TrimSpace(lines[i])
		if tomlHeader.MatchString(text) {
			break
		}
		m := tomlKey.FindStringSubmatch(text)
		if m == nil {
			continue
		}
		name := strings.Trim(m[1], `"`)
		if !typeable(name) {
			continue
		}
		body, _ := tomlTask(strings.TrimSpace(m[2]))
		out = append(out, catalog.Command{Runner: "cargo", Name: name, Run: "cargo " + name, Body: body, Source: at(file, i+1)})

		if pkg := runsPackage(body); pkg != "" {
			out = append(out, readXtask(root, name, pkg)...)
		}
	}

	return out
}

// runsPackage is the package an alias expansion runs, when it is `run
// --package <name>` or `run -p <name>` - the xtask convention - and the
// alias leaves the subcommand to the caller. `gen = "run -p xtask -- gen"`
// names one subcommand already, and is listed as the one command it is.
func runsPackage(expansion string) string {
	fields := strings.Fields(expansion)
	if len(fields) == 0 || fields[0] != "run" {
		return ""
	}
	if i := slices.Index(fields, "--"); i >= 0 && i+1 < len(fields) {
		return ""
	}
	for i, f := range fields {
		if (f == "--package" || f == "-p") && i+1 < len(fields) {
			return fields[i+1]
		}
		if rest, ok := strings.CutPrefix(f, "--package="); ok {
			return rest
		}
	}

	return ""
}

// readXtask lists the subcommands of an xtask-style package by reading its
// main.rs for the two shapes they are written in: a match on the first
// argument (`"dist" => ...`, `Some("dist") => ...`), and a clap enum
// deriving Subcommand, whose variants are the commands in kebab-case. A
// `///` comment over a variant, or its `about`, is the doc.
func readXtask(root, alias, pkg string) []catalog.Command {
	for _, candidate := range []string{filepath.Join(pkg, "src", "main.rs"), filepath.Join("xtask", "src", "main.rs")} {
		raw, err := os.ReadFile(filepath.Join(root, candidate))
		if err != nil {
			continue
		}
		src := string(raw)
		file := filepath.ToSlash(filepath.Join(root, candidate))
		var out []catalog.Command
		seen := map[string]bool{}
		add := func(name, doc string, line int) {
			if seen[name] || !typeable(name) {
				return
			}
			seen[name] = true
			out = append(out, catalog.Command{Runner: "cargo", Name: alias + " " + name, Run: "cargo " + alias + " " + name, Doc: doc, Source: at(file, line)})
		}

		if e := xtaskEnum.FindStringSubmatchIndex(src); e != nil {
			body := src[e[2]:e[3]]
			lines := strings.Split(body, "\n")
			base := strings.Count(src[:e[2]], "\n") + 1
			for i, line := range lines {
				m := xtaskVariant.FindStringSubmatch(line)
				if m == nil {
					continue
				}
				doc := commentAbove(lines, i, "///")
				if doc == "" {
					if a := regexp.MustCompile(`about\s*=\s*"([^"]*)"`).FindStringSubmatch(strings.Join(lines[max(0, i-3):i], "\n")); a != nil {
						doc = a[1]
					}
				}
				add(kebab(m[1]), doc, base+i)
			}
		}
		lines := strings.Split(src, "\n")
		for _, m := range xtaskArm.FindAllStringIndex(src, -1) {
			// `Some("bench") | Some("perf") =>` is one arm and two names, and
			// the `//` comment over the arm is what both are for.
			line := strings.Count(src[:m[0]], "\n")
			doc := commentAbove(lines, line, "//")
			for _, literal := range xtaskLiteral.FindAllStringSubmatch(src[m[0]:m[1]], -1) {
				add(literal[1], doc, line+1)
			}
		}

		return out
	}

	return nil
}

func kebab(name string) string {
	var b strings.Builder
	for i, r := range name {
		if r >= 'A' && r <= 'Z' {
			if i > 0 {
				b.WriteByte('-')
			}
			b.WriteRune(r + 'a' - 'A')

			continue
		}
		b.WriteRune(r)
	}

	return b.String()
}
