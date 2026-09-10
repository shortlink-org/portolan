// Command portolan-go is every built-in Go plugin in one binary.
//
// Built for wasip1 it is plugins/portolan-go.wasm: the host runs it once per
// step with the plugin's manifest name as argv[0], and the workspace preopened
// for extract and verify steps (portolan.0006). Run as a process it takes the
// same name as its first argument - `go run ./plugins/cmd/portolan-go adr` -
// which is how a plugin that still needs a toolchain, or a developer at a
// terminal, reaches the same code.
package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	extractadr "github.com/shortlink-org/portolan/plugins/extract-adr"
	extractasyncapi "github.com/shortlink-org/portolan/plugins/extract-asyncapi"
	extractcommands "github.com/shortlink-org/portolan/plugins/extract-commands"
	extractcsr "github.com/shortlink-org/portolan/plugins/extract-csr"
	extractflows "github.com/shortlink-org/portolan/plugins/extract-flows"
	extractglossary "github.com/shortlink-org/portolan/plugins/extract-glossary"
	extractgo "github.com/shortlink-org/portolan/plugins/extract-go"
	extractgonats "github.com/shortlink-org/portolan/plugins/extract-go-nats"
	extractgosqs "github.com/shortlink-org/portolan/plugins/extract-go-sqs"
	extractgraphql "github.com/shortlink-org/portolan/plugins/extract-graphql"
	extractopenapi "github.com/shortlink-org/portolan/plugins/extract-openapi"
	extractproject "github.com/shortlink-org/portolan/plugins/extract-project"
	extractproto "github.com/shortlink-org/portolan/plugins/extract-proto"
	extractredis "github.com/shortlink-org/portolan/plugins/extract-redis"
	extractriver "github.com/shortlink-org/portolan/plugins/extract-river"
	extractsql "github.com/shortlink-org/portolan/plugins/extract-sql"
	extractwatermill "github.com/shortlink-org/portolan/plugins/extract-watermill"
	extractwsdl "github.com/shortlink-org/portolan/plugins/extract-wsdl"
	genbackstage "github.com/shortlink-org/portolan/plugins/gen-backstage"
	genmarkdown "github.com/shortlink-org/portolan/plugins/gen-markdown"
	genmermaid "github.com/shortlink-org/portolan/plugins/gen-mermaid"
	verifycodeowners "github.com/shortlink-org/portolan/plugins/verify-codeowners"
	verifyotel "github.com/shortlink-org/portolan/plugins/verify-otel"
)

// Plugins maps a manifest plugin name to what answers it. The names are the
// ones portolan.json declares as built-ins; a test holds the two in step.
var Plugins = map[string]func(io.Reader, io.Writer) error{
	"project":      extractproject.Serve,
	"commands":     extractcommands.Serve,
	"go-domain":    extractgo.Serve,
	"openapi":      extractopenapi.Serve,
	"wsdl":         extractwsdl.Serve,
	"redis":        extractredis.Serve,
	"river":        extractriver.Serve,
	"watermill":    extractwatermill.Serve,
	"go-nats":      extractgonats.Serve,
	"go-sqs":       extractgosqs.Serve,
	"asyncapi":     extractasyncapi.Serve,
	"graphql":      extractgraphql.Serve,
	"sql":          extractsql.Serve,
	"proto":        extractproto.Serve,
	"csr-schemas":  extractcsr.Serve,
	"adr":          extractadr.Serve,
	"glossary":     extractglossary.Serve,
	"flows":        extractflows.Serve,
	"otel":         verifyotel.Serve,
	"codeowners":   verifycodeowners.Serve,
	"markdown":     genmarkdown.Serve,
	"mermaid":      genmermaid.Serve,
	"backstage":    genbackstage.Serve,
}

func main() {
	name := pluginName(os.Args)
	serve, ok := Plugins[name]
	if !ok {
		names := make([]string, 0, len(Plugins))
		for known := range Plugins {
			names = append(names, known)
		}
		sort.Strings(names)
		fmt.Fprintf(os.Stderr, "portolan-go: no plugin named %q; one of %s\n", name, strings.Join(names, ", "))
		os.Exit(2)
	}
	if err := serve(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintf(os.Stderr, "portolan-%s: %v\n", name, err)
		os.Exit(1)
	}
}

// pluginName is argv[1] when a process was given one, else argv[0]: the wasm
// host names the plugin in argv[0] and passes nothing more.
func pluginName(args []string) string {
	if len(args) > 1 {
		return args[1]
	}
	if len(args) == 1 {
		return strings.TrimSuffix(filepath.Base(args[0]), ".wasm")
	}
	return ""
}
