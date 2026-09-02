package main

// The tokens of a .proto file, and the comments attached to them.
//
// Comments are not thrown away. A proto's leading comments are the only
// documentation it carries - a descriptor drops them unless SourceCodeInfo is
// asked for and carried around - and `Field.doc` in the catalog would come back
// empty without them. So the lexer keeps them, attaches each block to the token
// it precedes, and files each trailing one under the line it sits on.

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

type kind int

const (
	tokEOF kind = iota
	tokIdent
	tokString
	tokNumber
	tokPunct
)

type token struct {
	kind kind
	text string
	line int

	// doc is the comment block directly above this token, already cleaned.
	// Empty unless this token opens a declaration that was commented.
	doc string
}

func (t token) is(text string) bool {
	return (t.kind == tokPunct || t.kind == tokIdent) && t.text == text
}

// lexed is a file's tokens plus the comments that did not lead a declaration.
type lexed struct {
	tokens []token

	// trailing is the comment sitting at the end of a line, by line number.
	// A field documented to its right rather than above is common enough that
	// dropping it would lose real prose.
	trailing map[int]string
}

type lexer struct {
	src  string
	pos  int
	line int

	pending  []string // comment block being accumulated
	lastEnd  int      // line the last accumulated comment ended on
	trailing map[int]string
	lastTok  int // line of the last non-comment token, for trailing detection
}

func lex(src string) (lexed, error) {
	l := &lexer{src: src, line: 1, trailing: map[int]string{}, lastTok: -1}
	out := lexed{trailing: l.trailing}

	for {
		tok, err := l.next()
		if err != nil {
			return lexed{}, err
		}
		out.tokens = append(out.tokens, tok)
		if tok.kind == tokEOF {
			return out, nil
		}
	}
}

func (l *lexer) next() (token, error) {
	for {
		l.skipSpace()
		if l.pos >= len(l.src) {
			return token{kind: tokEOF, line: l.line}, nil
		}

		if l.src[l.pos] == '/' && l.pos+1 < len(l.src) {
			switch l.src[l.pos+1] {
			case '/':
				l.lineComment()

				continue
			case '*':
				if err := l.blockComment(); err != nil {
					return token{}, err
				}

				continue
			}
		}

		break
	}

	start := l.line
	c := l.src[l.pos]

	switch {
	case c == '"' || c == '\'':
		text, err := l.str()
		if err != nil {
			return token{}, err
		}

		return l.emit(token{kind: tokString, text: text, line: start}), nil

	case isIdentStart(c):
		begin := l.pos
		for l.pos < len(l.src) && isIdentPart(l.src[l.pos]) {
			l.pos++
		}

		return l.emit(token{kind: tokIdent, text: l.src[begin:l.pos], line: start}), nil

	case c >= '0' && c <= '9':
		begin := l.pos
		for l.pos < len(l.src) && isNumberPart(l.src[l.pos]) {
			l.pos++
		}

		return l.emit(token{kind: tokNumber, text: l.src[begin:l.pos], line: start}), nil

	default:
		l.pos++

		return l.emit(token{kind: tokPunct, text: string(c), line: start}), nil
	}
}

// emit hands the accumulated comment block to a token, but only when the block
// ends on the line above it. A comment separated by a blank line was about
// whatever came before, or about nothing, and attaching it would put a
// paragraph on a declaration that never claimed it.
func (l *lexer) emit(t token) token {
	if len(l.pending) > 0 {
		if l.lastEnd == t.line-1 {
			t.doc = strings.Join(l.pending, "\n")
		}
		l.pending = nil
	}
	l.lastTok = t.line

	return t
}

func (l *lexer) lineComment() {
	l.pos += 2
	begin := l.pos
	for l.pos < len(l.src) && l.src[l.pos] != '\n' {
		l.pos++
	}
	text := strings.TrimSpace(l.src[begin:l.pos])

	// A comment on the same line as the last token trails it rather than
	// leading whatever comes next.
	if l.line == l.lastTok {
		if prev, ok := l.trailing[l.line]; ok {
			l.trailing[l.line] = prev + " " + text
		} else {
			l.trailing[l.line] = text
		}

		return
	}

	if l.lastEnd != l.line-1 {
		l.pending = nil
	}
	l.pending = append(l.pending, text)
	l.lastEnd = l.line
}

func (l *lexer) blockComment() error {
	startLine := l.line
	l.pos += 2
	begin := l.pos
	for {
		if l.pos+1 >= len(l.src) {
			return fmt.Errorf("line %d: block comment is never closed", startLine)
		}
		if l.src[l.pos] == '*' && l.src[l.pos+1] == '/' {
			break
		}
		if l.src[l.pos] == '\n' {
			l.line++
		}
		l.pos++
	}
	body := l.src[begin:l.pos]
	l.pos += 2

	var lines []string
	for _, raw := range strings.Split(body, "\n") {
		line := strings.TrimSpace(raw)
		line = strings.TrimPrefix(line, "*")
		lines = append(lines, strings.TrimSpace(line))
	}
	for len(lines) > 0 && lines[0] == "" {
		lines = lines[1:]
	}
	for len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}

	if l.lastEnd != startLine-1 {
		l.pending = nil
	}
	l.pending = append(l.pending, lines...)
	l.lastEnd = l.line

	return nil
}

func (l *lexer) str() (string, error) {
	quote := l.src[l.pos]
	startLine := l.line
	l.pos++
	var b strings.Builder
	for {
		if l.pos >= len(l.src) {
			return "", fmt.Errorf("line %d: string is never closed", startLine)
		}
		c := l.src[l.pos]
		if c == quote {
			l.pos++

			return b.String(), nil
		}
		if c == '\n' {
			return "", fmt.Errorf("line %d: string is never closed", startLine)
		}
		if c == '\\' && l.pos+1 < len(l.src) {
			// The escape is kept as written. Nothing downstream interprets a
			// proto string literal; they are option values and default values,
			// and both are shown rather than evaluated.
			b.WriteByte(c)
			l.pos++
			b.WriteByte(l.src[l.pos])
			l.pos++

			continue
		}
		b.WriteByte(c)
		l.pos++
	}
}

func (l *lexer) skipSpace() {
	for l.pos < len(l.src) {
		c := l.src[l.pos]
		if c == '\n' {
			l.line++
			l.pos++

			continue
		}
		r, size := utf8.DecodeRuneInString(l.src[l.pos:])
		if !unicode.IsSpace(r) {
			return
		}
		l.pos += size
	}
}

func isIdentStart(c byte) bool {
	return c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func isIdentPart(c byte) bool {
	return isIdentStart(c) || (c >= '0' && c <= '9')
}

func isNumberPart(c byte) bool {
	return (c >= '0' && c <= '9') || c == '.' || c == 'x' || c == 'X' ||
		(c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F') || c == '-' || c == '+'
}
