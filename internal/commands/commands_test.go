package commands

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shortlink-org/portolan/catalog"
)

var update = flag.Bool("update", false, "rewrite the golden list instead of comparing against it")

const goldenPath = "testdata/golden/commands.json"

func read(t *testing.T) []catalog.Command {
	t.Helper()
	cmds, warnings := Read("testdata/estate")
	if len(warnings) != 0 {
		t.Fatalf("warnings: %v", warnings)
	}

	return cmds
}

func find(t *testing.T, cmds []catalog.Command, run string) catalog.Command {
	t.Helper()
	for _, cmd := range cmds {
		if cmd.Run == run {
			return cmd
		}
	}
	t.Fatalf("no command %q in %s", run, names(cmds))

	return catalog.Command{}
}

func names(cmds []catalog.Command) string {
	out := make([]string, 0, len(cmds))
	for _, cmd := range cmds {
		out = append(out, cmd.Run)
	}

	return strings.Join(out, ", ")
}

func absent(t *testing.T, cmds []catalog.Command, run string) {
	t.Helper()
	for _, cmd := range cmds {
		if cmd.Run == run {
			t.Errorf("%q is listed and should not be", run)
		}
	}
}

func TestMakefileTargetsAndDocs(t *testing.T) {
	cmds := read(t)

	gen := find(t, cmds, "make gen")
	if gen.Doc != "Regenerate the gRPC stubs" {
		t.Errorf("gen doc = %q", gen.Doc)
	}
	if !strings.HasPrefix(gen.Body, "buf generate $(GRPC)/quote/proto") || strings.Count(gen.Body, "\n") != 1 {
		t.Errorf("gen body = %q", gen.Body)
	}
	if gen.Source != "testdata/estate/Makefile:10" {
		t.Errorf("gen source = %q", gen.Source)
	}

	build := find(t, cmds, "make build")
	if build.Doc != "Compiles every package. Nothing is installed." {
		t.Errorf("comment over a target is its doc; got %q", build.Doc)
	}

	// Two targets on one rule are two commands.
	find(t, cmds, "make test")
	find(t, cmds, "make lint")
	// Inside a conditional is still a target.
	find(t, cmds, "make ci")

	for _, hidden := range []string{"make .PHONY", "make _internal", "make $(BIN)", "make %.pb.go", "make GRPC", "make BIN", "make ifeq"} {
		absent(t, cmds, hidden)
	}
}

func TestJustfileRecipes(t *testing.T) {
	cmds := read(t)

	dev := find(t, cmds, "just dev")
	if dev.Doc != "Run the service against the compose stack" || dev.Body != "docker compose up -d\ncargo run" {
		t.Errorf("dev = %+v", dev)
	}
	test := find(t, cmds, "just test")
	if test.Doc != "Run the tests, unit and integration" {
		t.Errorf("doc attribute beats the comment; got %q", test.Doc)
	}
	for _, hidden := range []string{"just release", "just _setup", "just alias", "just set", "just port"} {
		absent(t, cmds, hidden)
	}
}

func TestTaskfileTasks(t *testing.T) {
	cmds := read(t)

	build := find(t, cmds, "task build")
	if build.Doc != "Compile the binary" || build.Body != "go build -o bin/svc ./cmd/svc" {
		t.Errorf("build = %+v", build)
	}
	if migrate := find(t, cmds, "task migrate"); migrate.Doc != "Apply pending migrations" || migrate.Body != "goose up" {
		t.Errorf("migrate = %+v", migrate)
	}
	if def := find(t, cmds, "task default"); def.Body != "task build" {
		t.Errorf("default = %+v", def)
	}
	if fmt := find(t, cmds, "task fmt"); fmt.Body != "gofmt -w ." {
		t.Errorf("fmt = %+v", fmt)
	}
	absent(t, cmds, "task lint")
	absent(t, cmds, "task _shared")
}

func TestPackageScriptsInFileOrder(t *testing.T) {
	cmds := read(t)

	var npm []string
	for _, cmd := range cmds {
		if cmd.Runner == "npm" {
			npm = append(npm, cmd.Run)
		}
	}
	want := "npm run build, npm start, npm test, npm run build:watch, npm run generate, npm run generate:api"
	if got := strings.Join(npm, ", "); got != want {
		t.Errorf("scripts = %s\n     want %s", got, want)
	}
	if build := find(t, cmds, "npm run build"); build.Body != "tsc -p tsconfig.build.json" || build.Source != "testdata/estate/package.json:4" {
		t.Errorf("build = %+v", build)
	}
	if watch := find(t, cmds, "npm run build:watch"); watch.Source != "testdata/estate/package.json:8" {
		t.Errorf("a name containing another name has its own line; got %q", watch.Source)
	}
}

func TestPackageRunnerFollowsTheLockfile(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"scripts":{"test":"vitest"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "pnpm-lock.yaml"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	cmds, _ := Read(root)
	if len(cmds) != 1 || cmds[0].Run != "pnpm test" || cmds[0].Runner != "pnpm" {
		t.Errorf("commands = %+v", cmds)
	}
}

func TestPyprojectTasks(t *testing.T) {
	cmds := read(t)

	if test := find(t, cmds, "poe test"); test.Body != "pytest" {
		t.Errorf("test = %+v", test)
	}
	if lint := find(t, cmds, "poe lint"); lint.Body != "ruff check ." {
		t.Errorf("lint = %+v", lint)
	}
	if serve := find(t, cmds, "poe serve"); serve.Doc != "Run the dev server" || serve.Body != "python manage.py runserver" {
		t.Errorf("serve = %+v", serve)
	}
	migrate := find(t, cmds, "poe migrate")
	if migrate.Doc != "Apply pending migrations" || migrate.Body != "python manage.py migrate" || migrate.Source != "testdata/estate/pyproject.toml:14" {
		t.Errorf("migrate = %+v", migrate)
	}
	if check := find(t, cmds, "poe check"); check.Body != "lint\ntest" {
		t.Errorf("check = %+v", check)
	}
	if worker := find(t, cmds, "pdm run worker"); worker.Doc != "Run the celery worker" || worker.Body != "celery -A billing worker" {
		t.Errorf("worker = %+v", worker)
	}
	find(t, cmds, "pdm run test")
	absent(t, cmds, "pdm run pre_test")
	absent(t, cmds, "poe _hidden")
	// Entry points are programs the package installs, not tasks.
	absent(t, cmds, "poe billing")
}

func TestPomPhasesAndPluginGoals(t *testing.T) {
	cmds := read(t)

	if test := find(t, cmds, "mvn test"); test.Source != "testdata/estate/pom.xml:5" || test.Doc == "" {
		t.Errorf("test = %+v", test)
	}
	find(t, cmds, "mvn package")
	if run := find(t, cmds, "mvn spring-boot:run"); run.Doc != "Run the application" || run.Source != "testdata/estate/pom.xml:22" {
		t.Errorf("spring-boot:run = %+v", run)
	}
	// A plugin bound to a phase is run by the phase, not typed; a plugin
	// under pluginManagement or in dependencies is not part of the build.
	for _, hidden := range []string{"mvn protobuf:compile", "mvn jib:dockerBuild", "mvn flyway:migrate"} {
		absent(t, cmds, hidden)
	}
}

func TestPomIsTypedAtTheWrapper(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "pom.xml"), []byte("<project><packaging>jar</packaging></project>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "mvnw"), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	cmds, _ := Read(root)
	if len(cmds) != 2 || cmds[0].Run != "./mvnw test" || cmds[0].Runner != "./mvnw" {
		t.Errorf("commands = %+v", cmds)
	}
}

func TestGradleTasks(t *testing.T) {
	cmds := read(t)

	find(t, cmds, "gradle build")
	find(t, cmds, "gradle test")
	if run := find(t, cmds, "gradle run"); run.Source != "testdata/estate/build.gradle.kts:3" {
		t.Errorf("run = %+v", run)
	}
	if boot := find(t, cmds, "gradle bootRun"); boot.Source != "testdata/estate/build.gradle.kts:2" {
		t.Errorf("bootRun = %+v", boot)
	}
	if gen := find(t, cmds, "gradle generateProto"); gen.Doc != "Regenerate the gRPC stubs" || gen.Source != "testdata/estate/build.gradle.kts:6" {
		t.Errorf("generateProto = %+v", gen)
	}
	if smoke := find(t, cmds, "gradle smokeTest"); smoke.Doc != "Run the tests that need the compose stack" {
		t.Errorf("smokeTest = %+v", smoke)
	}
	find(t, cmds, "gradle legacyTask")
	absent(t, cmds, "gradle _shared")
}

func TestCargoAliasesAndXtask(t *testing.T) {
	cmds := read(t)

	if xtask := find(t, cmds, "cargo xtask"); xtask.Body != "run --package xtask --" || xtask.Source != "testdata/estate/.cargo/config.toml:5" {
		t.Errorf("xtask = %+v", xtask)
	}
	if gen := find(t, cmds, "cargo gen"); gen.Body != "run --package xtask -- gen" {
		t.Errorf("gen = %+v", gen)
	}
	absent(t, cmds, "cargo _secret")

	if gen := find(t, cmds, "cargo xtask gen"); gen.Doc != "Regenerate the gRPC stubs from the vendored protos" || gen.Source != "testdata/estate/xtask/src/main.rs:12" {
		t.Errorf("xtask gen = %+v", gen)
	}
	if ci := find(t, cmds, "cargo xtask ci"); ci.Doc != "Run fmt, clippy and the tests the way CI does" {
		t.Errorf("xtask ci = %+v", ci)
	}
	if dist := find(t, cmds, "cargo xtask dist"); dist.Doc != "Build the release artefacts" {
		t.Errorf("xtask dist = %+v", dist)
	}
	// Match arms add what the enum does not name, once each.
	if bench := find(t, cmds, "cargo xtask bench"); bench.Doc != "Run the benchmarks against the compose stack" {
		t.Errorf("bench = %+v", bench)
	}
	if perf := find(t, cmds, "cargo xtask perf"); perf.Doc != "Run the benchmarks against the compose stack" {
		t.Errorf("perf = %+v", perf)
	}
	count := 0
	for _, cmd := range cmds {
		if cmd.Run == "cargo xtask gen" {
			count++
		}
	}
	if count != 1 {
		t.Errorf("cargo xtask gen listed %d times", count)
	}
}

func TestNothingToReadIsNothing(t *testing.T) {
	cmds, warnings := Read(t.TempDir())
	if len(cmds) != 0 || len(warnings) != 0 {
		t.Errorf("commands = %+v, warnings = %v", cmds, warnings)
	}
}

func TestBrokenFilesWarnRatherThanFail(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "Taskfile.yml"), []byte("tasks: [\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"scripts": "nope"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	cmds, warnings := Read(root)
	if len(cmds) != 0 || len(warnings) != 2 {
		t.Errorf("commands = %+v, warnings = %v", cmds, warnings)
	}
}

func TestGolden(t *testing.T) {
	cmds := read(t)
	got, err := json.MarshalIndent(cmds, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	got = append(got, '\n')
	if *update {
		if err := os.MkdirAll(filepath.Dir(goldenPath), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(goldenPath, got, 0o644); err != nil {
			t.Fatal(err)
		}

		return
	}
	want, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("%v (run with -update to write it)", err)
	}
	if string(want) != string(got) {
		t.Errorf("golden differs from what is read now; run with -update and review the diff\n%s", got)
	}
}
