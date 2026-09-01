package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/shortlink-org/portolan/plugin"
)

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-gen-markdown:", err)
		os.Exit(1)
	}
}

func run(stdin io.Reader, stdout io.Writer) error {
	in, err := io.ReadAll(stdin)
	if err != nil {
		return fmt.Errorf("reading the request: %w", err)
	}

	var req plugin.Request
	if err := json.Unmarshal(in, &req); err != nil {
		return fmt.Errorf("the request is not a portolan plugin request: %w", err)
	}

	var opts Options
	if len(req.Options) > 0 {
		if err := json.Unmarshal(req.Options, &opts); err != nil {
			return fmt.Errorf("options: %w", err)
		}
	}

	out, err := json.Marshal(render(req, opts))
	if err != nil {
		return fmt.Errorf("encoding the response: %w", err)
	}

	if _, err := stdout.Write(out); err != nil {
		return fmt.Errorf("writing the response: %w", err)
	}

	return nil
}
