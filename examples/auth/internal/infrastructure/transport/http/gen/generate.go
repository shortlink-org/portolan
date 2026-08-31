// Package gen is the output of oapi-codegen over openapi.yaml.
//
// This file is the only hand-written one in the package, and it exists to hold
// the directive: `go generate` runs with the working directory of the file it
// is written in, so keeping it here is what makes the relative paths in
// cfg.yaml land in this directory rather than in the parent.
package gen

//go:generate go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.0 -config cfg.yaml openapi.yaml
