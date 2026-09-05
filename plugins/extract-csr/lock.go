package main

// The lock, as this side reads it.
//
// A narrower copy of what portolan-fetch-csr writes, on purpose: this plugin
// needs the subject, the version and which file holds the schema, and reading
// a shape it does not use would be a second place to keep the writer's
// decisions in step. The two are held together by the fields' names, which is
// the same contract every fragment in this repository is held to.
type Lock struct {
	Registry string        `json:"registry"`
	Subjects []LockSubject `json:"subjects"`
}

type LockSubject struct {
	Subject    string      `json:"subject"`
	Version    int         `json:"version"`
	ID         int         `json:"id"`
	SchemaType string      `json:"schemaType"`
	Files      []LockEntry `json:"files"`
}

type LockEntry struct {
	Path string `json:"path"`
}
