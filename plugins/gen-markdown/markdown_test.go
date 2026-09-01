package main

import "testing"

func TestRel(t *testing.T) {
	cases := []struct{ from, to, want string }{
		{"README.md", "types.md", "types.md"},
		{"README.md", "shop/oms/README.md", "shop/oms/README.md"},
		{"shop/oms/README.md", "shop/oms/aggregates/order.md", "aggregates/order.md"},
		{"shop/oms/aggregates/order.md", "types.md", "../../../types.md"},
		{"shop/oms/aggregates/order.md", "shop/pricing/README.md", "../../pricing/README.md"},
		{"flows/checkout.md", "shop/oms/README.md", "../shop/oms/README.md"},
		{"adr/org.0001.md", "adr/org.0002.md", "org.0002.md"},
	}

	for _, c := range cases {
		if got := rel(c.from, c.to); got != c.want {
			t.Errorf("rel(%q, %q) = %q, want %q", c.from, c.to, got, c.want)
		}
	}
}

func TestShiftHeadingsLeavesCodeAlone(t *testing.T) {
	in := "# Title\n\n```sh\n# not a heading\n```\n\n## Section\n"
	want := "## Title\n\n```sh\n# not a heading\n```\n\n### Section\n"

	if got := shiftHeadings(in, 1); got != want {
		t.Errorf("shiftHeadings:\n got: %q\nwant: %q", got, want)
	}
}

func TestShiftHeadingsStopsAtSix(t *testing.T) {
	if got := shiftHeadings("###### deep", 1); got != "###### deep" {
		t.Errorf("a sixth-level heading must stay put, got %q", got)
	}
	if got := shiftHeadings("#hashtag", 1); got != "#hashtag" {
		t.Errorf("a hash with no space is not a heading, got %q", got)
	}
}

// A readme opening with the page's own title would give the page two h1s, so
// that line is dropped and the rest keeps its depth.
func TestBodyDropsRepeatedTitle(t *testing.T) {
	got := body("# Basket\n\n## Lifetime\n\nShort.", "Basket")
	if got != "## Lifetime\n\nShort." {
		t.Errorf("body kept the repeated title: %q", got)
	}

	got = body("Just prose.\n\n# Later heading", "Basket")
	if got != "Just prose.\n\n## Later heading" {
		t.Errorf("body should shift a document that does not open with the title: %q", got)
	}
}

func TestCellSurvivesPipesAndNewlines(t *testing.T) {
	if got := cell("a | b\nc"); got != "a \\| b c" {
		t.Errorf("cell = %q", got)
	}
	if got := cell("  "); got != "—" {
		t.Errorf("an empty cell should be a dash, got %q", got)
	}
}

func TestMermaidTextEscapesHashBeforeSemicolons(t *testing.T) {
	// The escape for # ends in a semicolon, so the order of the two
	// replacements is the whole of this function's correctness.
	if got := mermaidText("markPaid #1; twice"); got != "markPaid #35;1, twice" {
		t.Errorf("mermaidText = %q", got)
	}
}

func TestAnchor(t *testing.T) {
	if got := anchor("Gateway Ref"); got != "gateway-ref" {
		t.Errorf("anchor = %q", got)
	}
}
