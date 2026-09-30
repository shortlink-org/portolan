package extractsql

import (
	"regexp"
	"strings"
	"unicode"
)

// The table an ORM gives a type it was not told the table of.
//
// gorm and ent both derive it from the Go type's name, snake-cased and
// pluralised, and a wrong derivation is an access landing on a table that does
// not exist - so the rules are ported rather than approximated: gorm's
// toDBName with its initialisms, and the English plural rules both libraries
// pluralise with (jinzhu/inflection's defaults; ent's go-openapi/inflect
// agrees with them on every ordinary noun).

// gormInitialisms are the words gorm's naming strategy keeps together:
// UserID is user_id, not user_i_d.
var gormInitialisms = strings.NewReplacer(func() []string {
	var pairs []string
	for _, word := range []string{"API", "ASCII", "CPU", "CSS", "DNS", "EOF", "GUID", "HTML", "HTTP", "HTTPS", "ID", "IP", "JSON", "LHS", "QPS", "RAM", "RHS", "RPC", "SLA", "SMTP", "SSH", "TLS", "TTL", "UID", "UI", "UUID", "URI", "URL", "UTF8", "VM", "XML", "XSRF", "XSS"} {
		pairs = append(pairs, word, word[:1]+strings.ToLower(word[1:]))
	}
	return pairs
}()...)

// gormDBName is gorm's schema.NamingStrategy.toDBName.
func gormDBName(name string) string {
	if name == "" {
		return ""
	}
	value := gormInitialisms.Replace(name)
	var b strings.Builder
	upper := func(c byte) bool { return c >= 'A' && c <= 'Z' }
	lastCase, curCase := false, upper(value[0])
	for i := 0; i < len(value)-1; i++ {
		v := value[i]
		nextCase := upper(value[i+1])
		nextNumber := value[i+1] >= '0' && value[i+1] <= '9'
		if curCase {
			if lastCase && (nextCase || nextNumber) {
				b.WriteByte(v + 32)
			} else {
				if i > 0 && value[i-1] != '_' && value[i+1] != '_' {
					b.WriteByte('_')
				}
				b.WriteByte(v + 32)
			}
		} else {
			b.WriteByte(v)
		}
		lastCase = curCase
		curCase = nextCase
	}
	last := value[len(value)-1]
	if curCase {
		if !lastCase && len(value) > 1 {
			b.WriteByte('_')
		}
		b.WriteByte(last + 32)
	} else {
		b.WriteByte(last)
	}
	return b.String()
}

// entSnake is ent's snake: UserInfo is user_info, HTTPRequest is
// http_request.
func entSnake(s string) string {
	var b strings.Builder
	j := 0
	for i := 0; i < len(s); i++ {
		r := rune(s[i])
		if i > 0 && i < len(s)-1 && unicode.IsUpper(r) {
			if unicode.IsLower(rune(s[i-1])) ||
				j != i-1 && unicode.IsLower(rune(s[i+1])) && unicode.IsLetter(rune(s[i-1])) {
				j = i
				b.WriteString("_")
			}
		}
		b.WriteRune(unicode.ToLower(r))
	}
	return b.String()
}

type inflection struct {
	find    *regexp.Regexp
	replace string
}

// plurals is tried in order and the first match wins: uncountables, then
// irregulars, then the rules with the most specific last.
var plurals = func() []inflection {
	var out []inflection
	for _, word := range []string{"equipment", "information", "rice", "money", "species", "series", "fish", "sheep", "jeans", "police"} {
		out = append(out, inflection{regexp.MustCompile(`^(?i)(` + word + `)$`), "${1}"})
	}
	irregular := [][2]string{{"person", "people"}, {"man", "men"}, {"child", "children"}, {"sex", "sexes"}, {"move", "moves"}, {"mombie", "mombies"}}
	for i := len(irregular) - 1; i >= 0; i-- {
		find, replace := irregular[i][0], irregular[i][1]
		out = append(out,
			inflection{regexp.MustCompile(strings.ToUpper(find) + `$`), strings.ToUpper(replace)},
			inflection{regexp.MustCompile(strings.ToUpper(find[:1]) + find[1:] + `$`), strings.ToUpper(replace[:1]) + replace[1:]},
			inflection{regexp.MustCompile(find + `$`), replace},
		)
	}
	rules := [][2]string{
		{`([a-z])$`, "${1}s"},
		{`s$`, "s"},
		{`^(ax|test)is$`, "${1}es"},
		{`(octop|vir)us$`, "${1}i"},
		{`(octop|vir)i$`, "${1}i"},
		{`(alias|status|campus)$`, "${1}es"},
		{`(bu)s$`, "${1}ses"},
		{`(buffal|tomat)o$`, "${1}oes"},
		{`([ti])um$`, "${1}a"},
		{`([ti])a$`, "${1}a"},
		{`sis$`, "ses"},
		{`(?:([^f])fe|([lr])f)$`, "${1}${2}ves"},
		{`(hive)$`, "${1}s"},
		{`([^aeiouy]|qu)y$`, "${1}ies"},
		{`(x|ch|ss|sh)$`, "${1}es"},
		{`(matr|vert|ind)(?:ix|ex)$`, "${1}ices"},
		{`^(m|l)ouse$`, "${1}ice"},
		{`^(m|l)ice$`, "${1}ice"},
		{`^(ox)$`, "${1}en"},
		{`^(oxen)$`, "${1}"},
		{`(quiz)$`, "${1}zes"},
		{`(drive)$`, "${1}s"},
	}
	for i := len(rules) - 1; i >= 0; i-- {
		out = append(out, inflection{regexp.MustCompile(`(?i)` + rules[i][0]), rules[i][1]})
	}
	return out
}()

func plural(word string) string {
	for _, rule := range plurals {
		if rule.find.MatchString(word) {
			return rule.find.ReplaceAllString(word, rule.replace)
		}
	}
	return word
}

// gormNaming is what a gorm.Config's NamingStrategy says about table names,
// when the config is a literal this reader can see.
type gormNaming struct {
	prefix   string
	singular bool
	// unknown is why the default name cannot be derived: a strategy set from
	// something other than literals, or one with a replacer this reader does
	// not run. Empty when the defaults, or a literal strategy, apply.
	unknown string
}

func (n gormNaming) table(typeName string) string {
	name := gormDBName(typeName)
	if !n.singular {
		name = plural(name)
	}
	return n.prefix + name
}

func entTable(typeName string) string {
	return entSnake(plural(typeName))
}
