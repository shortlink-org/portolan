package commands

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/shortlink-org/portolan/catalog"
)

// mavenGoals are the goals a person types, by the plugin that declares them.
// Maven has no task list of its own: the pom declares plugins, and a plugin's
// goals are either bound to a lifecycle phase - run by `mvn package`, never
// typed - or offered to be typed, and only the plugin's documentation says
// which. This is that documentation, for the plugins an estate meets.
var mavenGoals = map[string][]struct{ goal, doc string }{
	"spring-boot-maven-plugin":       {{"spring-boot:run", "Run the application"}},
	"quarkus-maven-plugin":           {{"quarkus:dev", "Run the application in dev mode, reloading on change"}},
	"flyway-maven-plugin":            {{"flyway:migrate", "Apply pending migrations"}},
	"liquibase-maven-plugin":         {{"liquibase:update", "Apply pending changesets"}},
	"exec-maven-plugin":              {{"exec:java", "Run the main class"}},
	"jib-maven-plugin":               {{"jib:dockerBuild", "Build the container image into the local Docker daemon"}},
	"docker-maven-plugin":            {{"docker:build", "Build the container image"}},
	"openapi-generator-maven-plugin": {{"openapi-generator:generate", "Regenerate code from the OpenAPI document"}},
}

var pomArtifact = regexp.MustCompile(`<artifactId>\s*([^<\s]+)\s*</artifactId>`)

// readPom lists what a Maven project answers to: the two lifecycle phases
// every pom accepts, and the goals of the plugins it declares under
// `<build><plugins>`. The line is typed at the wrapper when the checkout
// keeps one, because that is the Maven the project was built with.
func readPom(root, file, src string) []catalog.Command {
	runner, prefix := "mvn", "mvn "
	if _, err := os.Stat(filepath.Join(root, "mvnw")); err == nil {
		runner, prefix = "./mvnw", "./mvnw "
	}

	lines := strings.Split(src, "\n")
	self := 1
	for i, line := range lines {
		if strings.Contains(line, "<packaging>") {
			self = i + 1

			break
		}
	}

	out := []catalog.Command{
		{Runner: runner, Name: "test", Run: prefix + "test", Doc: "Run the tests (lifecycle phase)", Source: at(file, self)},
		{Runner: runner, Name: "package", Run: prefix + "package", Doc: "Build the artifact (lifecycle phase)", Source: at(file, self)},
	}

	// Only the build's own plugins, not the ones a dependency's pom names
	// or the ones under <pluginManagement>, which pin a version without
	// running anything.
	build := section(src, "build")
	if build == "" {
		return out
	}
	plugins := section(strings.Replace(build, section(build, "pluginManagement"), "", 1), "plugins")
	offset := strings.Index(src, plugins)
	seen := map[string]bool{}
	for _, m := range pomArtifact.FindAllStringSubmatchIndex(plugins, -1) {
		artifact := plugins[m[2]:m[3]]
		goals, known := mavenGoals[artifact]
		if !known || seen[artifact] {
			continue
		}
		seen[artifact] = true
		line := 1 + strings.Count(src[:offset+m[2]], "\n")
		for _, g := range goals {
			out = append(out, catalog.Command{Runner: runner, Name: g.goal, Run: prefix + g.goal, Doc: g.doc, Source: at(file, line)})
		}
	}

	return out
}

// section is the text of the first `<name>...</name>` element, or "".
func section(src, name string) string {
	open := strings.Index(src, "<"+name+">")
	if open < 0 {
		return ""
	}
	close := strings.Index(src[open:], "</"+name+">")
	if close < 0 {
		return ""
	}

	return src[open : open+close+len(name)+3]
}
