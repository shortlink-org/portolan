package verifycodeowners

import "testing"

func TestParseReadsRulesAndSkipsTheRest(t *testing.T) {
	parsed := parseCodeowners(`# Who to ask.

*                       @acme/platform
/docs                   @acme/writers   @someone
examples/shop/oms       @acme/oms-team  # the team that wrote it

examples/legacy
`)

	if parsed.Sections {
		t.Error("no sections in this file")
	}
	if len(parsed.Rules) != 4 {
		t.Fatalf("rules = %+v, want four", parsed.Rules)
	}
	if parsed.Rules[1].Pattern != "/docs" || len(parsed.Rules[1].Owners) != 2 {
		t.Errorf("second rule = %+v", parsed.Rules[1])
	}
	// A trailing comment is not an owner.
	if got := parsed.Rules[2].Owners; len(got) != 1 || got[0] != "@acme/oms-team" {
		t.Errorf("third rule owners = %v", got)
	}
	// A pattern with nobody after it is how ownership is taken back, so it is
	// a rule and not a blank line.
	if parsed.Rules[3].Pattern != "examples/legacy" || len(parsed.Rules[3].Owners) != 0 {
		t.Errorf("fourth rule = %+v", parsed.Rules[3])
	}
	// The line number is what a warning about a rule that owns nothing points at.
	if parsed.Rules[2].Line != 5 {
		t.Errorf("line = %d, want 5", parsed.Rules[2].Line)
	}
}

func TestParseNoticesSections(t *testing.T) {
	for _, header := range []string{"[Backend]", "^[Optional]", "[Frontend][2]"} {
		parsed := parseCodeownersFor(header+"\n* @acme/platform\n", gitLab)
		if !parsed.Sections {
			t.Errorf("%q was not read as a section header", header)
		}
		if len(parsed.Rules) != 1 {
			t.Errorf("%q: rules = %+v, want the one below it", header, parsed.Rules)
		}
	}
}

// GitHub does not support escaping a leading hash. The forge skips this line,
// so the catalog must not invent ownership from it.
func TestGitHubParseRejectsAnEscapedLeadingHash(t *testing.T) {
	parsed := parseCodeowners(`\#docs @acme/writers`)

	if len(parsed.Rules) != 0 {
		t.Fatalf("rules = %+v, want GitHub to skip the unsupported pattern", parsed.Rules)
	}
}

func TestGitLabParseKeepsEscapedSpaces(t *testing.T) {
	parsed := parseCodeownersFor(`docs/user\ guides @acme/writers`, gitLab)

	if len(parsed.Rules) != 1 || parsed.Rules[0].Pattern != `docs/user guides` {
		t.Fatalf("rules = %+v", parsed.Rules)
	}
	if len(parsed.Rules[0].Owners) != 1 || parsed.Rules[0].Owners[0] != "@acme/writers" {
		t.Errorf("owners = %v", parsed.Rules[0].Owners)
	}
}

func TestGitLabParseRecognisesRolesAsOwners(t *testing.T) {
	parsed := parseCodeownersFor(`* @@maintainer`, gitLab)

	if len(parsed.Rules) != 1 || len(parsed.Rules[0].Owners) != 1 || parsed.Rules[0].Owners[0] != "@@maintainer" {
		t.Fatalf("rules = %+v", parsed.Rules)
	}
}

func TestGitLabParsesOwnersAfterAnInlineHash(t *testing.T) {
	parsed := parseCodeownersFor(`* @acme/platform # @acme/not-a-comment-owner`, gitLab)

	if len(parsed.Rules) != 1 || len(parsed.Rules[0].Owners) != 2 || parsed.Rules[0].Owners[1] != "@acme/not-a-comment-owner" {
		t.Fatalf("rules = %+v", parsed.Rules)
	}
}

func TestGitHubParseDoesNotTreatGitLabExclusionAsANegatedRule(t *testing.T) {
	parsed := parseCodeowners(`!docs @acme/writers`)

	if len(parsed.Rules) != 0 {
		t.Fatalf("rules = %+v, want the unsupported negation skipped", parsed.Rules)
	}
}
