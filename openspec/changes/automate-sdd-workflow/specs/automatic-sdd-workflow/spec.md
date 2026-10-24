# Spec Delta

## ADDED Requirements

### Requirement: Standard OpenSpec layouts are connected automatically
Portolan SHALL detect a project containing `openspec/changes/<change>/.openspec.yaml` and SHALL include its normalized SDD fragment without requiring plugin options or a manually authored extraction step. An explicit SDD step for the same project SHALL take precedence and SHALL run only once.

#### Scenario: Standard OpenSpec repository is discovered
- **WHEN** project discovery scans a repository with at least one standard OpenSpec change
- **THEN** SDD is selected with the project root as input and no redundant default options

#### Scenario: Explicit configuration already exists
- **WHEN** the manifest already contains an SDD extraction step for the project
- **THEN** Portolan uses that step and does not add or run an implicit duplicate

### Requirement: Specification history comes from Git
Portolan SHALL derive first and latest change metadata for a specification and its source artifacts from repository history without writing that metadata into the extracted fragment.

#### Scenario: Full history is available
- **WHEN** a specification source path has committed history
- **THEN** its page shows the first commit, latest commit, author and date with links to the exact source revision when repository information is available

#### Scenario: History is unavailable
- **WHEN** the checkout is shallow, uncommitted-only or not a Git repository
- **THEN** the specification remains available and history is shown as unavailable with the reason

### Requirement: Changed paths produce explainable impact
Portolan SHALL relate branch changes to catalog components using repository identity and the longest exact owning path. The relation SHALL be presented as change impact and SHALL NOT be presented as implementation or conformance evidence.

#### Scenario: Changed file belongs to one service
- **WHEN** a changed repository-relative file is under exactly one known service path
- **THEN** the specification activity links that service and explains the matching path

#### Scenario: Changed file has no unique owner
- **WHEN** no service path matches or multiple owners remain equally specific
- **THEN** impact stays at repository level and Portolan does not choose a service

### Requirement: Only exact textual references become links
Portolan SHALL recognize web URLs, repository-relative paths with optional lines, exact catalog IDs, and same-change requirement or task IDs. Portolan SHALL preserve unresolved exact references and SHALL NOT link ordinary prose by semantic similarity.

#### Scenario: Exact catalog ID resolves
- **WHEN** a specification artifact contains an exact ID present in the merged catalog
- **THEN** the rendered text links to that entity's canonical Portolan route

#### Scenario: Similar display name is ambiguous
- **WHEN** prose contains a name that resembles one or more catalog entities but is not an exact identifier
- **THEN** the text remains prose and no relationship is created

#### Scenario: Source path includes a line
- **WHEN** an artifact mentions a repository-relative `path:line` that exists inside the project root
- **THEN** the rendered link opens that exact source location

### Requirement: Activity is deterministic and shared
Portolan SHALL build one activity stream from Git history, spec diffs, lifecycle transitions, task transitions and path impact. The same normalized events SHALL feed the specification page, Changes presentation and generated summaries.

#### Scenario: Several event kinds have the same timestamp
- **WHEN** activity events cannot be ordered by time alone
- **THEN** Portolan orders them deterministically by kind and stable key

#### Scenario: A branch changes requirements and tasks
- **WHEN** the compared branch adds a requirement and completes a task
- **THEN** both events appear in the activity feed and Changes view with links to their source sections

### Requirement: Specifications participate in global navigation
Portolan SHALL index changes, requirements and scenarios for global search and command palette navigation. Results SHALL retain their SDD kind and SHALL navigate to a stable route or section anchor.

#### Scenario: Requirement is found by title or ID
- **WHEN** a reader searches for an exact requirement ID or words from its title
- **THEN** the result is labeled as a requirement and opens that requirement on its specification page

#### Scenario: Removed requirement exists only in a branch diff
- **WHEN** a requirement exists on the comparison base but not in the current catalog
- **THEN** it remains visible in Changes but is not added to the current global search index

### Requirement: Automatic conclusions preserve evidence boundaries
Portolan SHALL label author intent, changed-with impact, declared architecture, test evidence and runtime observation as separate states. Task completion, co-change and exact links SHALL NOT independently produce verified conformance.

#### Scenario: Every task is checked
- **WHEN** a specification has a complete checklist but no runtime observation
- **THEN** lifecycle may be complete while conformance remains unverified

#### Scenario: Code and specification changed together
- **WHEN** Git shows a code path and specification artifact in the same commit
- **THEN** Portolan records related change impact without claiming that the requirement is implemented
