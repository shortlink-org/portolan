package main

import "strings"

// The id rules, in one place. Everything downstream - a table saying which
// aggregate it persists, a flow step naming an event, a link on a page - is a
// string built by one of these, so they are worth having exactly once.

func serviceID(context, service string) string { return context + "." + service }

func aggregateID(service, aggregate string) string { return service + "." + aggregate }

func blockID(aggregate, block string) string { return aggregate + "." + block }

func eventID(aggregate, name string) string { return aggregate + "." + name }

// slug turns a Go identifier into the kebab-case form ids and urls use:
// PriceList becomes price-list, Address becomes address, ID stays id.
func slug(name string) string {
	var b strings.Builder

	runes := []rune(name)
	for i, r := range runes {
		upper := r >= 'A' && r <= 'Z'
		if upper && i > 0 {
			// A dash goes in at the start of a word, which is either a lower
			// letter followed by an upper one (orderLine) or the end of an
			// acronym followed by a word (HTTPServer).
			prevLower := runes[i-1] >= 'a' && runes[i-1] <= 'z'
			nextLower := i+1 < len(runes) && runes[i+1] >= 'a' && runes[i+1] <= 'z'
			if prevLower || nextLower {
				b.WriteRune('-')
			}
		}
		if upper {
			r = r - 'A' + 'a'
		}
		if r == '_' || r == '.' {
			r = '-'
		}
		b.WriteRune(r)
	}

	// A separator in the source and a word boundary at the same spot would
	// otherwise give email.Address the slug "email--address".
	return collapseDashes(b.String())
}

func collapseDashes(s string) string {
	for strings.Contains(s, "--") {
		s = strings.ReplaceAll(s, "--", "-")
	}

	return strings.Trim(s, "-")
}

// camel turns a directory name into the operation id a reader expects:
// change_password becomes ChangePassword.
func camel(name string) string {
	var b strings.Builder
	for _, word := range strings.FieldsFunc(name, func(r rune) bool { return r == '_' || r == '-' }) {
		runes := []rune(word)
		if runes[0] >= 'a' && runes[0] <= 'z' {
			runes[0] = runes[0] - 'a' + 'A'
		}
		b.WriteString(string(runes))
	}

	return b.String()
}

// title is the human name for a package: user becomes User, price_list becomes
// Price List.
func title(name string) string {
	words := strings.FieldsFunc(name, func(r rune) bool { return r == '_' || r == '-' })
	for i, word := range words {
		runes := []rune(word)
		if runes[0] >= 'a' && runes[0] <= 'z' {
			runes[0] = runes[0] - 'a' + 'A'
		}
		words[i] = string(runes)
	}

	return strings.Join(words, " ")
}
