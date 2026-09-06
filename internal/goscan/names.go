package goscan

import "strings"

// LastSegment is what follows the last dot: the name off a type key, the
// event off a wire name.
func LastSegment(value string) string {
	if at := strings.LastIndex(value, "."); at >= 0 {
		return value[at+1:]
	}
	return value
}

// Slug is a value as an identifier in a URL or a catalog id: lower case,
// runs of anything else collapsed to one dash, none at the ends.
func Slug(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var out strings.Builder
	dash := false
	for _, r := range value {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' {
			out.WriteRune(r)
			dash = false
		} else if out.Len() > 0 && !dash {
			out.WriteByte('-')
			dash = true
		}
	}
	return strings.TrimSuffix(out.String(), "-")
}

// Title is a slug or an identifier as words: split on dash, underscore and
// dot, each capitalised.
func Title(value string) string {
	parts := strings.FieldsFunc(value, func(r rune) bool { return r == '-' || r == '_' || r == '.' })
	for i := range parts {
		if parts[i] != "" {
			parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	return strings.Join(parts, " ")
}

// FirstNonEmpty is the first value that is more than whitespace.
func FirstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
