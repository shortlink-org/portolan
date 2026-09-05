package main

// The tokens of a GraphQL SDL document, and the descriptions attached to them.
//
// A schema documents itself in strings rather than in comments: `# ...` is
// thrown away by every reader, and the prose a client is meant to see sits in
// a string literal directly above the thing it describes. So the lexer keeps
// string tokens as tokens - the parser decides which of them are descriptions -
// and drops comments on the floor, which is the opposite of what the proto
// lexer beside it has to do.

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

type kind int

const (
	tokEOF kind = iota
	tokName
	tokString
	tokNumber
	tokPunct
)

type token struct {
	kind kind
	text string
	line int
}

func (t token) is(text string) bool {
	return (t.kind == tokPunct || t.kind == tokName) && t.text == text
}

type lexer struct {
	src  string
	pos  int
	line int
}

func lex(src string) ([]token, error) {
	l := &lexer{src: strings.TrimPrefix(src, "\ufeff"), line: 1}

	var out []token
	for {
		tok, err := l.next()
		if err != nil {
			return nil, err
		}
		out = append(out, tok)
		if tok.kind == tokEOF {
			return out, nil
		}
	}
}

func (l *lexer) next() (token, error) {
	for {
		l.skipIgnored()
		if l.pos >= len(l.src) {
			return token{kind: tokEOF, line: l.line}, nil
		}

		c := l.src[l.pos]
		switch {
		case c == '#':
			l.lineComment()
			continue
		case c == '"':
			return l.stringLiteral()
		case c == '_' || isLetter(c):
			return l.name(), nil
		case c == '-' || isDigit(c):
			return l.number(), nil
		}

		// `...` is one token; every other punctuator is one byte. Nothing else
		// is legal, and a document that reaches here is one no server would
		// serve either.
		if strings.HasPrefix(l.src[l.pos:], "...") {
			tok := token{kind: tokPunct, text: "...", line: l.line}
			l.pos += 3
			return tok, nil
		}
		if strings.ContainsRune("!$&()::=@[]{|}", rune(c)) {
			tok := token{kind: tokPunct, text: string(c), line: l.line}
			l.pos++
			return tok, nil
		}

		return token{}, fmt.Errorf("line %d: %q is not a graphql token", l.line, string(c))
	}
}

// skipIgnored eats whitespace and the commas GraphQL treats as whitespace.
func (l *lexer) skipIgnored() {
	for l.pos < len(l.src) {
		switch l.src[l.pos] {
		case '\n':
			l.line++
			l.pos++
		case ' ', '\t', '\r', ',':
			l.pos++
		default:
			return
		}
	}
}

func (l *lexer) lineComment() {
	for l.pos < len(l.src) && l.src[l.pos] != '\n' {
		l.pos++
	}
}

func (l *lexer) name() token {
	start := l.pos
	for l.pos < len(l.src) && (isLetter(l.src[l.pos]) || isDigit(l.src[l.pos]) || l.src[l.pos] == '_') {
		l.pos++
	}

	return token{kind: tokName, text: l.src[start:l.pos], line: l.line}
}

// number is lexed only so a default value can be stepped over. Nothing in the
// catalog is interested in what it says.
func (l *lexer) number() token {
	start := l.pos
	l.pos++
	for l.pos < len(l.src) && (isDigit(l.src[l.pos]) || strings.ContainsRune(".eE+-", rune(l.src[l.pos]))) {
		l.pos++
	}

	return token{kind: tokNumber, text: l.src[start:l.pos], line: l.line}
}

func (l *lexer) stringLiteral() (token, error) {
	line := l.line
	if strings.HasPrefix(l.src[l.pos:], `"""`) {
		l.pos += 3
		start := l.pos
		for {
			if l.pos >= len(l.src) {
				return token{}, fmt.Errorf("line %d: a block string is never closed", line)
			}
			if strings.HasPrefix(l.src[l.pos:], `"""`) && (l.pos == start || l.src[l.pos-1] != '\\') {
				text := l.src[start:l.pos]
				l.line += strings.Count(text, "\n")
				l.pos += 3
				return token{kind: tokString, text: blockString(text), line: line}, nil
			}
			l.pos++
		}
	}

	l.pos++
	var b strings.Builder
	for {
		if l.pos >= len(l.src) || l.src[l.pos] == '\n' {
			return token{}, fmt.Errorf("line %d: a string is never closed", line)
		}
		c := l.src[l.pos]
		if c == '"' {
			l.pos++
			return token{kind: tokString, text: b.String(), line: line}, nil
		}
		if c == '\\' && l.pos+1 < len(l.src) {
			l.pos++
			switch l.src[l.pos] {
			case 'n':
				b.WriteByte('\n')
			case 't':
				b.WriteByte('\t')
			case 'u':
				if l.pos+4 < len(l.src) {
					var r rune
					if _, err := fmt.Sscanf(l.src[l.pos+1:l.pos+5], "%04x", &r); err == nil {
						b.WriteRune(r)
						l.pos += 4
					}
				}
			default:
				b.WriteByte(l.src[l.pos])
			}
			l.pos++
			continue
		}
		r, size := utf8.DecodeRuneInString(l.src[l.pos:])
		b.WriteRune(r)
		l.pos += size
	}
}

// blockString applies the indentation rules the spec gives for `"""` strings:
// the common indent of every line after the first is removed, and blank lines
// at either end go with it. Without this every description in the catalog
// would carry the indentation of the schema file it was written in.
func blockString(raw string) string {
	lines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")

	indent := -1
	for _, line := range lines[1:] {
		trimmed := strings.TrimLeft(line, " \t")
		if trimmed == "" {
			continue
		}
		if width := len(line) - len(trimmed); indent < 0 || width < indent {
			indent = width
		}
	}
	if indent > 0 {
		for i, line := range lines[1:] {
			if len(line) >= indent {
				lines[i+1] = line[indent:]
			} else {
				lines[i+1] = strings.TrimLeft(line, " \t")
			}
		}
	}

	for len(lines) > 0 && strings.TrimSpace(lines[0]) == "" {
		lines = lines[1:]
	}
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}

	return strings.Join(lines, "\n")
}

func isLetter(c byte) bool { return unicode.IsLetter(rune(c)) && c < utf8.RuneSelf }

func isDigit(c byte) bool { return c >= '0' && c <= '9' }
