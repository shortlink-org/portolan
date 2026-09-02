package main

// The only file that knows the registry's wire.
//
// The BSR's public API is Connect, and a Connect unary call is an ordinary
// HTTP POST carrying the request message as JSON - so this needs net/http and
// encoding/json and nothing else. No grpc dependency, no protobuf runtime, in
// a go.mod that has two narrow dependencies.
//
// The message shapes below are buf/registry/module/v1, and the JSON names are
// protojson's: lowerCamelCase, `bytes` as base64. Everything the wire knows is
// in this file on purpose - if buf changes the shape, or the older
// buf.alpha.registry.v1alpha1 endpoints have to be fallen back to, this is the
// only file that moves.

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	downloadMethod = "/buf.registry.module.v1.DownloadService/Download"
	commitsMethod  = "/buf.registry.module.v1.CommitService/GetCommits"

	// The Connect protocol asks a client to say which version it speaks.
	connectVersionHeader = "Connect-Protocol-Version"
	connectVersion       = "1"
)

// resourceRef names a module and which version of it is wanted.
type resourceRef struct {
	Name *refName `json:"name,omitempty"`
	ID   string   `json:"id,omitempty"`
}

type refName struct {
	Owner  string `json:"owner"`
	Module string `json:"module"`
	// Ref is untyped: a commit id, a label, a tag. A pinned module always sends
	// a commit id, which is the only form that makes a download reproducible.
	Ref string `json:"ref,omitempty"`
}

type downloadRequest struct {
	Values []downloadValue `json:"values"`
}

type downloadValue struct {
	ResourceRef resourceRef `json:"resourceRef"`
	// Only .proto: the docs and licence a module also carries are not something
	// portolan reads, and fetching them would put files in the tree that
	// nothing explains.
	FileTypes []string `json:"fileTypes,omitempty"`
	Paths     []string `json:"paths,omitempty"`
	// Without this, narrowing to a path the module does not have is an error
	// rather than an empty answer.
	PathsAllowNotExist bool `json:"pathsAllowNotExist,omitempty"`
}

type downloadResponse struct {
	Contents []struct {
		Commit wireCommit `json:"commit"`
		Files  []struct {
			Path string `json:"path"`
			// bytes on the wire, so base64 in JSON.
			Content []byte `json:"content"`
		} `json:"files"`
	} `json:"contents"`
}

type wireCommit struct {
	ID     string `json:"id"`
	Digest struct {
		Type  string `json:"type"`
		Value []byte `json:"value"`
	} `json:"digest"`
}

// display renders a digest the way buf writes one: `b5:<hex>`.
func (c wireCommit) display() string {
	if len(c.Digest.Value) == 0 {
		return ""
	}
	kind := strings.ToLower(strings.TrimPrefix(c.Digest.Type, "DIGEST_TYPE_"))
	if kind == "" || kind == "unspecified" {
		kind = "b5"
	}

	return kind + ":" + hex.EncodeToString(c.Digest.Value)
}

type getCommitsRequest struct {
	ResourceRefs []resourceRef `json:"resourceRefs"`
}

type getCommitsResponse struct {
	Commits []wireCommit `json:"commits"`
}

// client talks to one registry.
type client struct {
	http  *http.Client
	base  string
	token string
}

func newClient(registry, token string) *client {
	return &client{
		// A timeout rather than none: a plugin that hangs holds up the whole
		// generate run, and the host has no way to interrupt it.
		http:  &http.Client{Timeout: 60 * time.Second},
		base:  baseURL(registry),
		token: token,
	}
}

// baseURL lets a registry be given with a scheme.
//
// buf.build is https and needs no help. A self-hosted BSR behind a plain-http
// internal address does, and so does a test server - which is the same need,
// and worth meeting once rather than threading a seam through the plugin.
func baseURL(registry string) string {
	if strings.HasPrefix(registry, "http://") || strings.HasPrefix(registry, "https://") {
		return strings.TrimSuffix(registry, "/")
	}

	return "https://" + registry
}

// download fetches a module's .proto files at a given ref.
func (c *client) download(owner, module, ref string, paths []string) (wireCommit, map[string][]byte, error) {
	req := downloadRequest{Values: []downloadValue{{
		ResourceRef:        resourceRef{Name: &refName{Owner: owner, Module: module, Ref: ref}},
		FileTypes:          []string{"FILE_TYPE_PROTO"},
		Paths:              paths,
		PathsAllowNotExist: len(paths) > 0,
	}}}

	var resp downloadResponse
	if err := c.call(downloadMethod, req, &resp); err != nil {
		return wireCommit{}, nil, err
	}
	if len(resp.Contents) == 0 {
		return wireCommit{}, nil, fmt.Errorf("%s/%s: the registry returned no content", owner, module)
	}

	content := resp.Contents[0]
	files := make(map[string][]byte, len(content.Files))
	for _, f := range content.Files {
		files[f.Path] = f.Content
	}

	return content.Commit, files, nil
}

// resolve turns a label into the commit it currently points at.
func (c *client) resolve(owner, module, ref string) (wireCommit, error) {
	req := getCommitsRequest{ResourceRefs: []resourceRef{
		{Name: &refName{Owner: owner, Module: module, Ref: ref}},
	}}

	var resp getCommitsResponse
	if err := c.call(commitsMethod, req, &resp); err != nil {
		return wireCommit{}, err
	}
	if len(resp.Commits) == 0 {
		return wireCommit{}, fmt.Errorf("%s/%s: no commit for %q", owner, module, ref)
	}

	return resp.Commits[0], nil
}

func (c *client) call(method string, in, out any) error {
	body, err := json.Marshal(in)
	if err != nil {
		return err
	}

	url := c.base + method
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(connectVersionHeader, connectVersion)
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 256<<20))
	if err != nil {
		return err
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: %s", method, connectError(resp.StatusCode, raw))
	}

	return json.Unmarshal(raw, out)
}

// connectError reads the error body Connect sends, falling back to the status
// when the body is not one.
func connectError(status int, body []byte) string {
	var wire struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &wire); err == nil && wire.Message != "" {
		if wire.Code != "" {
			return wire.Code + ": " + wire.Message
		}

		return wire.Message
	}

	return fmt.Sprintf("http %d", status)
}

// splitModule breaks `buf.build/acme/shop` into its three parts.
func splitModule(name string) (registry, owner, module string, err error) {
	parts := strings.Split(strings.TrimSpace(name), "/")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return "", "", "", fmt.Errorf("%q is not a module name; expected <registry>/<owner>/<module>", name)
	}

	return parts[0], parts[1], parts[2], nil
}
