package main

// The same fact read out of a repository written in Java, where JPA already
// writes it down: an entity says which table it is and each field says which
// column it is.
//
//	@Entity
//	@Table(name = "payments")
//	class PaymentEntity {
//	    @Column(name = "order_id", nullable = false)
//	    private String orderId;
//
// So this is the one language where the mapping is not read off the statements
// that write the rows - there are none to read, Spring Data writes them - but
// off the annotations that decide what those statements will say. A field with
// no @Column is still mapped: JPA derives the column from the field name, and
// the derivation is the same snake_case every Spring Boot project defaults to.
//
// The domain object is the entity's own name without the suffix the row shape
// carries: PostingEntity holds Posting, and a column of the postings table maps
// to `Posting.account` rather than to the aggregate root it hangs off.

import (
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/shortlink-org/portolan/plugin"
)

var (
	javaEntity = regexp.MustCompile(`(?s)@Entity\b.*?@Table\s*\(\s*name\s*=\s*"([^"]+)"[^)]*\).*?(?:class|record)\s+(\w+)`)
	javaColumn = regexp.MustCompile(`@Column\s*\(([^)]*)\)\s*(?:@[\w.]+\s*(?:\([^)]*\)\s*)?)*(?:private|protected|public)?\s*(?:final\s+)?[\w.<>\[\], ]+\s+(\w+)\s*[;=]`)
	javaField  = regexp.MustCompile(`(?m)^\s*(?:private|protected|public)\s+(?:final\s+)?[\w.<>\[\], ]+\s+(\w+)\s*;`)
	javaName   = regexp.MustCompile(`name\s*=\s*"([^"]+)"`)
)

func readMapsJava(root, repositories, aggregate string, b *plugin.Builder) map[string]map[string]string {
	out := map[string]map[string]string{}
	dir := path.Join(repositories, aggregate)

	entries, err := os.ReadDir(filepath.Join(root, filepath.FromSlash(dir)))
	if err != nil {
		return out
	}

	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".java") {
			continue
		}

		source, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(dir), name))
		if err != nil {
			b.Warn(dir, path.Join(dir, name)+" could not be read: "+err.Error())

			continue
		}
		text := string(source)

		found := javaEntity.FindStringSubmatch(text)
		if found == nil {
			continue
		}
		table, block := found[1], strings.TrimSuffix(found[2], "Entity")

		columns := map[string]string{}
		// The annotated ones first: what the annotation says wins over what the
		// name would have been derived to.
		annotated := map[string]bool{}
		for _, match := range javaColumn.FindAllStringSubmatch(text, -1) {
			field := match[2]
			column := field
			if named := javaName.FindStringSubmatch(match[1]); named != nil {
				column = named[1]
			} else {
				column = snake(field)
			}
			columns[column] = block + "." + field
			annotated[field] = true
		}
		for _, match := range javaField.FindAllStringSubmatch(text, -1) {
			field := match[1]
			if annotated[field] {
				continue
			}
			columns[snake(field)] = block + "." + field
		}

		if len(columns) > 0 {
			out[table] = columns
		}
	}

	return out
}

// snake is the column name JPA derives from a field when nothing says
// otherwise: orderId becomes order_id.
func snake(field string) string {
	var b strings.Builder
	for i, r := range field {
		if r >= 'A' && r <= 'Z' {
			if i > 0 {
				b.WriteByte('_')
			}
			b.WriteRune(r - 'A' + 'a')

			continue
		}
		b.WriteRune(r)
	}

	return b.String()
}
