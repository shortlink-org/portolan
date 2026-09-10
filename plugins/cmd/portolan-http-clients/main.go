// Command portolan-http-clients is the native sidecar for typed Go call-graph
// analysis. It intentionally does not compile for WASI: go/packages needs the
// project Go toolchain to load build tags and dependencies before SSA/VTA can
// resolve interface calls.
package main

import (
	"fmt"
	"os"

	extracthttpclients "github.com/shortlink-org/portolan/plugins/extract-http-clients"
)

func main() {
	if err := extracthttpclients.Serve(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-http-clients:", err)
		os.Exit(1)
	}
}
