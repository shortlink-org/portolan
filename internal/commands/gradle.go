package commands

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

var gradleRegister = regexp.MustCompile(`(?m)^[ \t]*(?:tasks\.register(?:<[^>]+>)?\(\s*["']([A-Za-z][\w-]*)["']|task\s+([A-Za-z][\w-]*)\s*[({]|val\s+([A-Za-z][\w-]*)\s+by\s+tasks\.(?:registering|creating))`)
var gradleDescription = regexp.MustCompile(`description\s*(?:=|\.set\()\s*["']([^"']*)["']`)
var gradlePlugin = regexp.MustCompile(`(?m)^[ \t]*(?:id\s*\(?\s*["']([\w.-]+)["']\)?|apply\s+plugin:\s*["']([\w.-]+)["']|\b(application|java|java-library|kotlin)\b\s*$)`)

// readGradle lists what a Gradle build answers to: `build` and `test`, which
// every JVM build has; `run` when the application plugin is applied and
// `bootRun` for Spring Boot; and the tasks the script registers itself, with
// the description it sets on them. The line is typed at the wrapper when the
// checkout keeps one.
//
// A build script is a program, and this reads it as text: a task registered
// inside a loop or by a plugin the script does not name is not here.
func readGradle(root, file, src string) []catalog.Command {
	runner, prefix := "gradle", "gradle "
	if _, err := os.Stat(filepath.Join(root, "gradlew")); err == nil {
		runner, prefix = "./gradlew", "./gradlew "
	}

	out := []catalog.Command{
		{Runner: runner, Name: "build", Run: prefix + "build", Doc: "Assemble and test the project", Source: file},
		{Runner: runner, Name: "test", Run: prefix + "test", Doc: "Run the tests", Source: file},
	}

	plugins := map[string]int{}
	for _, m := range gradlePlugin.FindAllStringSubmatchIndex(src, -1) {
		for _, group := range [][2]int{{m[2], m[3]}, {m[4], m[5]}, {m[6], m[7]}} {
			if group[0] >= 0 {
				plugins[src[group[0]:group[1]]] = 1 + strings.Count(src[:group[0]], "\n")
			}
		}
	}
	if line, ok := plugins["application"]; ok {
		out = append(out, catalog.Command{Runner: runner, Name: "run", Run: prefix + "run", Doc: "Run the application", Source: at(file, line)})
	}
	if line, ok := plugins["org.springframework.boot"]; ok {
		out = append(out, catalog.Command{Runner: runner, Name: "bootRun", Run: prefix + "bootRun", Doc: "Run the Spring Boot application", Source: at(file, line)})
	}

	matches := gradleRegister.FindAllStringSubmatchIndex(src, -1)
	for i, m := range matches {
		name := ""
		for _, group := range [][2]int{{m[2], m[3]}, {m[4], m[5]}, {m[6], m[7]}} {
			if group[0] >= 0 {
				name = src[group[0]:group[1]]
			}
		}
		if !typeable(name) {
			continue
		}
		// The description is read from the task's own block: from its
		// registration up to the next one. A script that sets one task's
		// description after registering the next is read wrong, and that
		// is the price of not running Gradle.
		end := len(src)
		if i+1 < len(matches) {
			end = matches[i+1][0]
		}
		doc := ""
		if d := gradleDescription.FindStringSubmatch(src[m[0]:end]); d != nil {
			doc = d[1]
		}
		out = append(out, catalog.Command{Runner: runner, Name: name, Run: prefix + name, Doc: doc, Source: at(file, 1+strings.Count(src[:m[0]], "\n"))})
	}

	return out
}
