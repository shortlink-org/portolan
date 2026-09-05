package main

// The registry's REST API, and only the two calls this plugin makes.
//
// A schema registry has a large surface - compatibility levels, modes, global
// configuration, deletion. None of it belongs here. This plugin reads
// registrations and writes nothing, which is what makes it safe to point at a
// production registry from a laptop.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Accept names the registry's own media type first and plain JSON second, so
// the same client works against Confluent's registry and the several
// API-compatible ones that only answer application/json.
const accept = "application/vnd.schemaregistry.v1+json, application/json"

type client struct {
	base string
	auth string
	http *http.Client
}

func newClient(base, auth string) *client {
	return &client{
		base: strings.TrimRight(base, "/"),
		auth: auth,
		// A registry that has stopped answering must fail the step rather than
		// hang a build until somebody notices.
		http: &http.Client{Timeout: 30 * time.Second},
	}
}

// registration is one version of one subject, as the registry answers it.
type registration struct {
	Subject string `json:"subject"`
	Version int    `json:"version"`

	// ID is the registry-global schema id - the four bytes a Kafka message
	// carries in its wire header. It identifies the SCHEMA, not the
	// registration: two subjects registering identical bytes share one id.
	ID int `json:"id"`

	// GUID is the newer, wider identifier for the same thing. Registries that
	// predate it leave it out, so it is never required.
	GUID string `json:"guid,omitempty"`

	// SchemaType is "AVRO", "PROTOBUF" or "JSON". Absent means AVRO: the
	// registry only started saying so when it stopped being the only option.
	SchemaType string `json:"schemaType,omitempty"`

	// Schema is the schema itself, as text. For AVRO and JSON that text is
	// itself JSON, which is why it arrives escaped inside a JSON field.
	Schema string `json:"schema"`

	References []Reference `json:"references,omitempty"`
}

// Reference is one subject a schema depends on, pinned by the referring schema
// rather than by the manifest. That is what makes a reference safe to follow
// without asking: it names a version, and a version is immutable.
type Reference struct {
	// Name is how the referring schema spells it - an Avro full name, a
	// protobuf import path, a JSON Schema `$ref` URL.
	Name    string `json:"name"`
	Subject string `json:"subject"`
	Version int    `json:"version"`
}

// apiError is the registry's own error shape. Read rather than ignored,
// because "Subject not found" and "Version not found" are the two mistakes a
// manifest actually makes, and the HTTP status alone says neither.
type apiError struct {
	Code    int    `json:"error_code"`
	Message string `json:"message"`
}

// version fetches one registration. A zero version asks for `latest`.
func (c *client) version(subject string, version int) (*registration, error) {
	which := "latest"
	if version > 0 {
		which = strconv.Itoa(version)
	}

	// Escaped, because a subject under RecordNameStrategy is a full name and
	// may hold anything the producer's language allows in one.
	at := c.base + "/subjects/" + url.PathEscape(subject) + "/versions/" + which

	var got registration
	if err := c.get(at, &got); err != nil {
		return nil, fmt.Errorf("%s at version %s: %w", subject, which, err)
	}
	if strings.TrimSpace(got.Schema) == "" {
		return nil, fmt.Errorf("%s at version %s: the registry answered with no schema", subject, which)
	}
	// A registry that answers `latest` says which version that was; one that
	// does not has told us nothing we could pin.
	if got.Version <= 0 {
		return nil, fmt.Errorf("%s at version %s: the registry did not say which version it answered with", subject, which)
	}

	return &got, nil
}

func (c *client) get(at string, into any) error {
	req, err := http.NewRequest(http.MethodGet, at, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", accept)
	if c.auth != "" {
		req.Header.Set("Authorization", c.auth)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return err
	}

	if resp.StatusCode != http.StatusOK {
		var fault apiError
		if json.Unmarshal(body, &fault) == nil && fault.Message != "" {
			return fmt.Errorf("the registry answered %s: %s (error_code %d)",
				resp.Status, fault.Message, fault.Code)
		}

		return fmt.Errorf("the registry answered %s", resp.Status)
	}

	if err := json.Unmarshal(body, into); err != nil {
		return fmt.Errorf("the registry's answer is not the shape this plugin reads: %w", err)
	}

	return nil
}

// schemaType normalizes the type. The empty answer is AVRO by the registry's
// own rule, and normalizing it here means nothing downstream has to know that.
func schemaType(declared string) string {
	if strings.TrimSpace(declared) == "" {
		return "AVRO"
	}

	return strings.ToUpper(strings.TrimSpace(declared))
}

// extensionFor is what the vendored file is called, so an editor opens it with
// the right syntax and a reviewer reads a diff rather than a wall of escapes.
func extensionFor(kind string) (string, error) {
	switch schemaType(kind) {
	case "AVRO":
		return ".avsc", nil
	case "PROTOBUF":
		return ".proto", nil
	case "JSON":
		return ".json", nil
	}

	return "", fmt.Errorf("unknown schema type %q", kind)
}

// body is the schema as it should be written to the tree.
//
// AVRO and JSON arrive as JSON minified onto one line, which makes a version
// bump a one-line diff nobody can read. Indenting it is done with json.Indent,
// which reformats the bytes without reordering them, so the file still says
// what the registry said, in the order it said it. PROTOBUF arrives as source
// and is left exactly as it is.
//
// The digest is taken over the bytes as written, so the reformatting is inside
// what the lock checks rather than something that has to be redone to verify.
func body(kind, schema string) string {
	if schemaType(kind) == "PROTOBUF" {
		return ensureNewline(schema)
	}

	var pretty bytes.Buffer
	if err := json.Indent(&pretty, []byte(schema), "", "  "); err != nil {
		// Not an error: a registry that answered with something that is not
		// JSON has told us something, and the honest thing is to keep it so
		// the reader can see what arrived.
		return ensureNewline(schema)
	}

	return ensureNewline(pretty.String())
}

func ensureNewline(s string) string {
	if strings.HasSuffix(s, "\n") {
		return s
	}

	return s + "\n"
}
