// Command verify-codeowners says who to ask about each service, by reading the
// CODEOWNERS file the repository already keeps.
//
// Ownership is the question a catalog is opened for and the one it answered
// worst: `owner` on a flow or a store means the bounded context, not a team,
// so "who do I ask about shop.oms" had no answer anywhere on the page. The
// answer was already written down - every repository with review rules has it,
// in a file the forge itself enforces - and typing it a second time into the
// manifest would make the copy the thing that goes stale.
//
// So it is read, never written, and never resolved. A handle is what the file
// says and what a reviewer types; turning `@acme/oms-team` into the people in
// it is a call to a forge's API, which needs a credential this deliberately
// does not have and would answer differently tomorrow.
//
// It is a verifier rather than an extractor because a rule is a path and only
// the merged catalog knows where each service is. It earns the name twice
// over: a service no rule matches, and a rule that matches no service, are
// both reported - the second being the failure a CODEOWNERS file has and can
// never report about itself, a team believing it owns something it does not.
//
// Nothing here is forge-specific. GitHub, GitLab and Gitea read the same file
// from the same three places; where GitLab's sections change whose rule wins,
// the file is read the flatter way and said so out loud.
//
//	{
//	  "plugins": [
//	    { "name": "codeowners", "process": { "command": "go", "args": ["run", "./plugins/verify-codeowners"] } }
//	  ],
//	  "verify": [
//	    { "plugin": "codeowners", "in": ".github", "out": "data", "options": { "out": "owners.json" } }
//	  ]
//	}
//
// Point `in` at the directory the file is in rather than at the repository
// root. The host dates a fragment from the last commit to touch the step's
// input, and the subject of this one is the CODEOWNERS file: rooted at the
// repository, it would be restamped by every commit ever made.
package main

import (
	"fmt"
	"io"
	"os"

	"github.com/shortlink-org/portolan/plugin"
)

// Options are what the manifest tells the verifier.
type Options struct {
	// File is the CODEOWNERS to read, relative to the input root. Left out,
	// the three places a forge looks: CODEOWNERS, .github/CODEOWNERS and
	// docs/CODEOWNERS, in that order.
	File string `json:"file,omitempty"`

	// Out names the fragment file.
	Out string `json:"out,omitempty"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "portolan-verify-codeowners:", err)
		os.Exit(1)
	}
}

func run(stdin io.Reader, stdout io.Writer) error {
	return plugin.Serve(stdin, stdout, descriptor(), func(req plugin.Request, opts Options) (plugin.Response, error) {
		if req.Input.Root == "" {
			return plugin.Response{}, fmt.Errorf("no input root: there is nowhere to look for a CODEOWNERS")
		}

		return verify(req, opts)
	})
}
