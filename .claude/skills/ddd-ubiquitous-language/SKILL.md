---
name: ddd-ubiquitous-language
description: Keep one vocabulary per bounded context — a glossary file, names that are the same in the glossary, the code, the events and the architecture model (LikeC4), and translation of foreign terms at the boundary. Use when naming a package, type, command, event or endpoint; when a term has two meanings or two terms mean one thing; when writing or updating a context's glossary; or when drawing the context in LikeC4, in any language.
---

# Ubiquitous language

One context, one vocabulary. A word means one thing inside the boundary,
and it is the same word in the glossary, the code, the events, the API and
the diagram. A reader who learns the glossary can read the tree.

## Rules

**The glossary is its own file.** `GLOSSARY.md` next to the service README,
one per bounded context. The README says what the service does; the glossary
says what the words mean. Neither repeats the other.

**One entry per term: the term, and what it means.** "Session: proof that a
user logged in, how long it is good for, and whether it has been taken away."
As long as it needs to be and no longer; a reader who has to be told what the
word is not is usually being told about two words.

**A term is either in the glossary or not used.** A new noun in the code is a
new entry, written first. A word that turns out to mean two things becomes
two words, both in the glossary.

**Names in code are glossary terms, unchanged.** The aggregate package is the
noun (`session`), the command is the verb the business uses (`Revoke`, not
`Delete`; `Start`, not `Create`), the event is the fact in the past tense
(`SessionEnded`), the use case is the verb phrase the caller asks for
(`change_password`). The transport uses the same words in routes and
messages.

**Synonyms are refused.** If the code says `revoke` the event does not say
`terminated`, the README does not say `killed`, the API does not say
`delete`. One of them is the term; the rest are edited out.

**Foreign terms are translated at the boundary, once.** Another service's
`Verdict` enum becomes this context's closed set in the adapter that speaks
to it, and nothing inside ever sees the foreign form. The glossary lists the
local term; the adapter's comment names what it maps from.

**The same word in two contexts is two entries.** `User` in auth is an id, an
email and a hash; `Customer` in shop is a name, addresses and a reference to
an auth user id. Neither context uses the other's word for its own thing.

**Refusals are in the language too.** The error a caller gets says the
glossary term ("that address is already registered"), not the table
constraint.

**The architecture model uses the glossary names.** Contexts, services,
aggregates and events in the LikeC4 model are the glossary's nouns, spelled
the same. See [references/likec4.md](references/likec4.md).

## Glossary layout

```
# Glossary — <context>

<a line or two on what the vocabulary covers, optional>

**Term.** What it means, in the words a person would use.
```

One paragraph per term, a blank line between them, alphabetical. The
paragraph opens with the term in bold, the full stop inside the bold, and
everything after it is the definition.

Prose, and only prose: no tables, no lists, no headings under the title. A
definition is one or two sentences of English, and a table row is where a
sentence goes to be truncated; prose also diffs by the sentence rather than
by the row.

Terms link nowhere; the glossary is the leaf everything else points to.

## Checklist

- `GLOSSARY.md` exists beside the README, one per context.
- Every package, type, command, event and route name appears in it.
- No two terms for one thing; no term with two meanings.
- Foreign enums and names are mapped in one adapter and never leak inward.
- LikeC4 model spells names as the glossary does.

Language-specific naming: [references/go.md](references/go.md).
