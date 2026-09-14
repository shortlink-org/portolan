# Git source settings

Open **Plugins → Git → Settings** (`/plugins/git/settings`). The page belongs to
the plugin, outside the global Settings tabs. Editing is available through the
local development server; published catalogs do not expose repository settings.

Configure one or more repository addresses, a branch/tag or full pinned commit
SHA. Connections include the whole source tree; directory filtering is not
supported. The cache directory is assigned automatically
from the project and repository name; snapshot paths are shown read-only. Connections belong
to the current project (the active catalog profile); there is no scope selector.
Git authentication uses the existing credential helper or SSH agent. Do not put
tokens or passwords in repository URLs.

**Branch or tag** loads a searchable, grouped list on opening, using the local
`POST /__portolan/git-fetch/refs` API and read-only `git ls-remote --refs --heads --tags`.
No clone or provider token is needed. Requests use the selected SSH/HTTPS URL,
non-interactive credentials and a 15-second timeout. Refresh reloads the list;
changing the repository discards its previous list. Choosing a revision saves its
full `refs/heads/…` or `refs/tags/…` name to avoid branch/tag ambiguity. Manual input
remains available on errors; an empty value uses remote HEAD. The API returns up
to 2,000 supported refs with a partial-list indicator; the menu shows up to 100
matches at once. Neither opening nor choosing a revision saves the draft.

**Project repositories** combines service and repository addresses from the
current profile, its configured connections and Git remotes belonging to its local
project checkout roots. **Connect existing** offers known addresses from elsewhere
in the workspace without importing another project's settings. Equivalent SSH/HTTPS addresses are grouped; local filesystem
remotes and credential-bearing URLs are omitted. This is not account-wide forge
discovery, and suggested transport alternatives have not been verified.

**Check access** explicitly runs a read-only `git ls-remote` with a 15-second
timeout and interactive prompts disabled. It does not clone, change the manifest
or trust new SSH hosts. Verify an unfamiliar host key in a terminal first.
The last completed result and its timestamp are remembered in this browser,
separately for each workspace and exact SSH/HTTPS URL, together with the selected
transport. Reloading does not trigger another check. The displayed time describes
a past observation, not a guarantee of current access. A local-server connection
failure leaves the previous observation intact; blocked browser storage falls
back to the current page session.
**Edit** expands a draft inside the repository card using the selected URL and
remote HEAD. Collapsing keeps the draft. Saving connects it only to the current
project. **Add repository by URL** keeps manual setup available.

**Save configuration** updates the `fetch-git` extraction step in `portolan.json`.
**Save, fetch & rebuild** additionally runs the full extraction and generation
pipeline, which can contact other configured services. Offline and CI execution
replays locked snapshots; successful generation is not proof of a new download.

New outputs must be dedicated empty directories under `vendor/repos/`, must not
overlap other pipeline outputs and must not traverse symlinks. Existing output
paths stay fixed to preserve downstream references. Concurrent manifest edits
require reloading the form before saving.

New output defaults are project-specific so the same monorepo can use independent
revisions in different projects. Editing an existing shared
step creates a separate step/output for the current project, preserving the original
for other projects. Its downstream extractors must be pointed at the new output.
Wildcard source patterns that prevent isolation must first be narrowed in
`portolan.json`; saving never silently broadens another project's connection.

The automatic project association includes generated `git.repo.json` metadata only. Configure source
extractors separately to derive services and flows. Removing connections may
remove their generated snapshot files on the next run.

`fetch-git` produces source snapshots, lock files and metadata, **not a persistent
Git checkout**. Work-item commit scanning still needs a checkout with `.git`
history. The page links to the task tracker’s Git-history requirements.
