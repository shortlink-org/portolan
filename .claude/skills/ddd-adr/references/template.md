# <scope>.<nnnn> — <Title, as a statement of the decision>

- **Status:** proposed | accepted | superseded by <scope>.<nnnn>
- **Date:** YYYY-MM-DD
- **Scope:** org | <context> | <context>.<service>

## Context and Problem Statement

<The question, phrased as a question. One paragraph on why the obvious
answer is wrong or costly.>

## Decision Drivers

- <what the answer must allow>
- <what the answer must make explicit>
- <what must be detectable rather than hoped against>

## Considered Options

1. **<Option, named as its proponent would>** — <one line>
2. **<Option>** — <one line>
3. **<Option>** — <one line>

## Decision Outcome

Chosen option: **<option>**.

| | <dimension> | <dimension> |
|---|---|---|
| <option 1> | | |
| <option 2> | | |
| <option 3> | | |

<The sentence that says why: what is given up, and why that is the cheaper
loss. The mitigation for the accepted risk, if any.>

### Consequences

- Good: <...>
- Good: <...>
- Bad: <...>
- Neutral: <...>

---

File: `docs/adr/<nnnn>-<slug>.md`. Index row: `| <scope>.<nnnn> | <title> | <status> | <date> | <scope> |`.

Example in this repository: `docs/adr/org.0001.md` (client proto copies live
in the consumer's infrastructure layer), superseded pair `shop.oms.0003` →
`shop.oms.0007`.
