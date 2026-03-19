# Upgrade and Catalog Versioning

vlurp today fetches, pins, verifies, scans, diffs, and catalogs skill content from GitHub repos. What it cannot do is upgrade. You can check if something is outdated (`vlurp outdated`), see what changed (`vlurp diff`), and re-fetch manually (`vlurp batch --force`). But there is no single operation that takes you from "I have v1" to "I have v2" while preserving the audit trail that SPEC.3 established.

This spec adds `vlurp upgrade` and `vlurp catalog-diff` -- the upgrade primitive and the structured changelog.

## Problem

The skill pack ecosystem is converging on two distribution models:

1. **git-clone-as-package-manager** -- Clone the repo into `~/.claude/skills/`, upgrade with `git pull`. This is what [gstack](https://github.com/garrytan/gstack) does. The upgrade mechanism is `git fetch && git reset --hard origin/main`, wrapped in a dedicated Claude Code skill that asks the user, runs the upgrade, and shows a summarized CHANGELOG.

2. **tarball-fetch-with-filtering** -- Download specific files from a repo, apply glob filters, pin to a ref. This is what vlurp does. The upgrade mechanism is... re-run the fetch commands manually.

Model 1 has a better upgrade story. Model 2 has better security properties (lineage tracking, integrity verification, content scanning, selective extraction). This spec gives model 2 a first-class upgrade story without sacrificing any of the security properties.

### What gstack gets right

gstack's upgrade system has four components worth studying:

| Component | What it does | How |
|-----------|-------------|-----|
| Version tracking | Know what version you're on | `VERSION` file (plain text) |
| Update check | Know when a new version exists | Bash script comparing local VERSION to GitHub raw URL, 24h cache |
| Self-upgrade | Apply the upgrade | Dedicated skill: detect install type, `git reset --hard`, run `./setup`, show what's new |
| Templating | Keep docs in sync with code | `.tmpl` files with `{{PLACEHOLDER}}` tokens resolved from source code at build time |

The update check is embedded into every skill's `SKILL.md` via a `{{UPDATE_CHECK}}` template placeholder. Every skill invocation checks for updates. The upgrade itself runs as a conversational Claude Code skill with `AskUserQuestion` prompts.

### What gstack gets wrong

The upgrade mechanism is `git reset --hard origin/main` followed by `./setup` -- a shell script that compiles a Bun binary and creates symlinks. This is an npm `postinstall` script by another name. The upstream repo author decides what code runs on your machine after every upgrade. The same supply chain attack vector that made `npm install` dangerous.

The templating system (`gen-skill-docs.ts`) is an author-side build concern that runs Bun to resolve `{{COMMAND_REFERENCE}}` and `{{SNAPSHOT_FLAGS}}` placeholders from TypeScript source code. This is fine as a build step in the upstream repo. It should never be something the consumer's package manager executes.

### What vlurp should do instead

Upgrading is fetching with better UX. The catalog is the structured changelog. No code execution. No lifecycle hooks. No trust escalation.

## Non-goals

- **No lifecycle hooks.** No `post-fetch`, no `post-upgrade`, no `setup` scripts. SPEC.3 said "No install scripts. No lifecycle hooks. Files are files." This spec does not change that. If a skill pack needs a build step, the consumer puts it in their own Makefile, their own CI, their own Claude Code hook. The package author never gets code execution on the consumer's machine.
- **No template engine.** vlurp does not process `.tmpl` files, resolve `{{PLACEHOLDER}}` tokens, or generate documentation from source code. That is the upstream repo's build system. vlurp fetches the already-built output.
- **No per-invocation update checks.** vlurp does not inject update check scripts into fetched SKILL.md files. `vlurp outdated` is the update check. The user runs it when they want to know.
- **No central version registry.** There is no VERSION file, no version number, no semver. The git ref (SHA) IS the version. It is globally unique, immutable, and requires no coordination.
- **No automatic upgrades.** `vlurp upgrade` requires the user to run it. It does not run in the background, on a schedule, or as a side effect of other commands.

## Architecture

The upgrade flow uses existing primitives in a new composition:

```
vlurp upgrade
    --> READ .vlurpfile (intent)
    --> READ .vlurp.jsonl (current state)
    --> for each source:
        --> RESOLVE upstream HEAD
        --> COMPARE against pinned ref
        --> if outdated:
            --> FETCH new content (existing fetch pipeline)
            --> CATALOG new content (existing catalog pipeline)
            --> DIFF catalogs (new: structured changelog)
            --> REWRITE .vlurpfile ref (new: vlurpfile writer)
            --> UPDATE .vlurp.jsonl lineage (existing)
    --> OUTPUT upgrade summary with catalog diff
```

No new trust boundaries. No code execution. The fetch pipeline already handles download, extraction, filtering, lineage recording, and scanning. The catalog pipeline already handles metadata extraction and indexing. The only new pieces are the vlurpfile writer and catalog diff.

## 1. UPGRADE (new command)

### `vlurp upgrade [source] [--vlurpfile <file>]`

Upgrade outdated sources to the current upstream HEAD. Combines `vlurp outdated` + `vlurp pin` + `vlurp fetch` + `vlurp catalog` into one atomic operation.

```sh
vlurp upgrade                         # upgrade all outdated in .vlurpfile
vlurp upgrade garrytan/gstack         # upgrade specific source
vlurp upgrade --dry-run               # preview what would change
vlurp upgrade --vlurpfile .vlurpfile  # explicit vlurpfile path
```

### Upgrade flow

**Step 1: Resolve current state**

Read the `.vlurpfile` to get intent (sources, filters, presets, pins). Read `.vlurp.jsonl` to get reality (what was actually fetched, when, with what hashes). If a specific source is given, filter to that entry.

**Step 2: Check upstream**

For each entry, resolve the upstream HEAD SHA via the GitHub API (existing `Fetcher.resolveHead()`). Compare against the pinned `--ref` in the `.vlurpfile` entry, or against the `ref` in the most recent lineage record for that source.

**Step 3: Snapshot current catalog**

Before fetching, run `vlurp catalog` on the current content to capture the pre-upgrade state. Store as `catalog.prev.json` (in memory, not written to disk unless `--dry-run`).

**Step 4: Fetch and catalog**

For each outdated source:

1. Fetch the new content using the existing fetch pipeline (download tarball, extract, filter, hash, write lineage). The `--force` flag is implicit -- upgrade always overwrites.
2. Run `vlurp catalog` on the newly fetched content.

**Step 5: Rewrite .vlurpfile**

Update the `--ref` value in the `.vlurpfile` entry for each upgraded source. If the entry had no `--ref` (was unpinned), add one. Preserve comments, whitespace, and ordering. The `.vlurpfile` is the lockfile.

**Step 6: Output**

Print the upgrade summary with a catalog diff for each upgraded source (see section 3).

### Dry run

`vlurp upgrade --dry-run` performs steps 1-3, then for each outdated source:
- Fetches upstream to a temp directory
- Catalogs the temp content
- Diffs catalogs
- Discards the temp content
- Does NOT modify `.vlurpfile`, `.vlurp.jsonl`, or local files

This is `terraform plan` for your skills.

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | All sources upgraded successfully (or all already current) |
| 1 | One or more sources failed to upgrade |
| 2 | No `.vlurpfile` found |

## 2. CATALOG VERSIONING (enhanced)

The existing `vlurp catalog` produces a `catalog.json` with skill metadata. This spec adds version awareness.

### Catalog schema (extended)

```json
{
  "generated_at": "2026-03-15T06:00:00Z",
  "vlurp_version": "2.0.0",
  "skills": {
    "browse": {
      "source": "github:garrytan/gstack",
      "ref": "abc1234",
      "path": "gstack/browse/SKILL.md",
      "name": "gstack",
      "version": "1.1.0",
      "description": "Fast headless browser for QA testing...",
      "tool_surface": ["Bash", "Read", "AskUserQuestion"],
      "command_surface": ["browse"],
      "supporting_files": ["bin/find-browse", "bin/remote-slug"],
      "fetched_at": "2026-03-15T05:00:00Z"
    },
    "review": {
      "source": "github:garrytan/gstack",
      "ref": "abc1234",
      "path": "gstack/review/SKILL.md",
      "name": "review",
      "version": "1.0.0",
      "description": "Pre-landing PR review...",
      "tool_surface": ["Bash", "Read", "Edit", "Write", "Grep", "Glob", "AskUserQuestion"],
      "command_surface": [],
      "supporting_files": ["TODOS-format.md", "checklist.md"],
      "fetched_at": "2026-03-15T05:00:00Z"
    }
  }
}
```

New field: `version` is extracted from the YAML frontmatter `version` key. This is the skill author's declared version, not a vlurp-assigned version. It is informational. The `ref` (git SHA) remains the authoritative identity.

### Catalog as version snapshot

Each `vlurp upgrade` produces a new catalog. The previous catalog is preserved (renamed to `catalog.prev.json`) so that `vlurp catalog-diff` can compare without re-fetching. The lineage record in `.vlurp.jsonl` links to the catalog state at fetch time via the shared `ref` and `fetched_at` fields.

The catalog IS the version manifest. It is derived from content on disk by vlurp's own code. No upstream-authored scripts. No code execution trust boundary.

## 3. CATALOG-DIFF (new command)

### `vlurp catalog-diff [old] [new]`

Structured comparison of two catalog snapshots. This replaces the gstack pattern of "read CHANGELOG.md and summarize with an LLM" with machine-readable, deterministic output.

```sh
vlurp catalog-diff                                    # compare catalog.prev.json vs catalog.json
vlurp catalog-diff catalog.prev.json catalog.json     # explicit paths
```

### Output format

```
garrytan/gstack  abc1234 -> def5678

  browse     1.0.0 -> 1.1.0
    tools:    +AskUserQuestion
    commands: (unchanged)
    files:    +bin/remote-slug

  review     1.0.0 -> 1.0.0
    tools:    (unchanged)
    commands: (unchanged)
    files:    +greptile-triage.md

  gstack-upgrade  (new skill)
    tools:    Bash, Read, AskUserQuestion
    commands: (none)

  old-skill  (removed)

Summary: 1 source, 8 skills (1 new, 1 removed, 2 changed, 4 unchanged)
```

### Diff categories

For each skill present in either catalog:

| Category | Detection |
|----------|-----------|
| **new** | Present in new catalog, absent in old |
| **removed** | Present in old catalog, absent in new |
| **changed** | Present in both, any field differs |
| **unchanged** | Present in both, all fields identical |

For changed skills, the diff reports which fields changed:

- `version`: old -> new
- `tool_surface`: +added, -removed
- `command_surface`: +added, -removed
- `supporting_files`: +added, -removed
- `description`: changed (show old/new if substantially different)

### Machine-readable output

`vlurp catalog-diff --json` produces:

```json
{
  "sources": {
    "github:garrytan/gstack": {
      "old_ref": "abc1234",
      "new_ref": "def5678"
    }
  },
  "skills": {
    "browse": {
      "status": "changed",
      "version": {"old": "1.0.0", "new": "1.1.0"},
      "tool_surface": {"added": ["AskUserQuestion"], "removed": []},
      "command_surface": {"added": [], "removed": []},
      "supporting_files": {"added": ["bin/remote-slug"], "removed": []}
    },
    "gstack-upgrade": {
      "status": "new",
      "version": {"old": null, "new": "1.0.0"},
      "tool_surface": {"added": ["Bash", "Read", "AskUserQuestion"], "removed": []},
      "command_surface": {"added": [], "removed": []},
      "supporting_files": {"added": [], "removed": []}
    }
  },
  "summary": {
    "total": 8,
    "new": 1,
    "removed": 1,
    "changed": 2,
    "unchanged": 4
  }
}
```

This is consumable by CI pipelines, Claude Code hooks, or any tool that wants to react to skill changes programmatically.

## 4. VLURPFILE WRITER (new internal)

`vlurp upgrade` needs to rewrite `.vlurpfile` entries with updated `--ref` values. This requires a vlurpfile writer that preserves the human-authored structure.

### Requirements

- Preserve comments (lines starting with `#`)
- Preserve blank lines and grouping
- Preserve argument ordering within each line
- Update only the `--ref` value for the targeted source
- Add `--ref` if the entry was previously unpinned
- Round-trip: `parse(write(parse(content))) === parse(content)` for all non-upgraded entries

### Implementation

The existing `parseVlurpfile()` is read-only and discards comments and whitespace. The writer needs a structure-preserving parser that operates on the raw text:

1. Split content into lines
2. Classify each line: comment, blank, or command
3. For command lines, find the `--ref` argument position (or the end of line if absent)
4. Replace or append the `--ref` value
5. Rejoin and write

This is a line-level text transform, not a full AST. The `.vlurpfile` format is simple enough that this is robust.

### Example

Before:
```sh
# gstack -- Workflow skills
vlurp garrytan/gstack -d .claude/skills --preset skills --ref abc1234

# obra -- Agent patterns
vlurp obra/superpowers -d ./skills --preset claude
```

After `vlurp upgrade`:
```sh
# gstack -- Workflow skills
vlurp garrytan/gstack -d .claude/skills --preset skills --ref def5678

# obra -- Agent patterns
vlurp obra/superpowers -d ./skills --preset claude --ref 789abcd
```

The comment and blank line are preserved. The gstack entry's `--ref` was updated. The obra entry gained a `--ref` (was previously unpinned, now pinned to the version that was fetched).

## Integration with existing commands

### `vlurp batch` (unchanged)

`vlurp batch` remains the "fetch everything" command. `vlurp upgrade` is the "fetch only what changed" command. They share the same fetch pipeline. The difference is that `upgrade` checks upstream first and only re-fetches outdated sources.

### `vlurp outdated` (unchanged)

`vlurp outdated` remains the read-only check. `vlurp upgrade --dry-run` is equivalent to `vlurp outdated` plus a catalog diff preview. Both are useful: `outdated` is fast (just HEAD resolution), `upgrade --dry-run` is thorough (fetches and catalogs temp content).

### `vlurp verify` (unchanged)

After `vlurp upgrade`, the lineage in `.vlurp.jsonl` reflects the new content. `vlurp verify` continues to work against the updated lineage.

### `vlurp scan` (unchanged)

The fetch pipeline already runs scans. Upgraded content gets scanned as part of the fetch. Scan results appear in the updated lineage records.

### `vlurp diff` (unchanged)

After `vlurp upgrade`, `vlurp diff` shows no changes (local matches upstream). Before upgrading, `vlurp diff` shows content-level changes. `vlurp catalog-diff` shows metadata-level changes. They are complementary: `diff` shows what text changed, `catalog-diff` shows what capabilities changed.

## Data files summary (updated from SPEC.3)

| File | Purpose | Authored by | Committed |
|------|---------|-------------|-----------|
| `.vlurpfile` | Fetch intent (sources, filters, pins) | Human + `vlurp upgrade` | Yes |
| `.vlurp.jsonl` | Lineage (provenance, hashes, scan results) | vlurp | Yes |
| `.vlurp.sigstore` | Cryptographic attestation (optional) | vlurp + sigstore | Yes |
| `catalog.json` | Current skill index | vlurp | Yes |
| `catalog.prev.json` | Previous skill index (for diffing) | vlurp | Optional |

## Implementation phases

### Phase 1: Vlurpfile Writer

- Structure-preserving `.vlurpfile` parser
- `--ref` update and insertion
- Round-trip test suite

This is the foundation. Without a vlurpfile writer, `vlurp upgrade` cannot record what it did.

### Phase 2: Upgrade Command

- `vlurp upgrade [source]` with full flow (resolve, fetch, catalog, rewrite)
- `vlurp upgrade --dry-run` with temp-directory fetch and preview
- Integration with existing fetch pipeline (lineage, scan, integrity)
- Ink-based progress UI consistent with other commands

### Phase 3: Catalog Diff

- `vlurp catalog-diff [old] [new]` with human-readable output
- `vlurp catalog-diff --json` for machine-readable output
- `catalog.prev.json` snapshot during upgrade
- Catalog schema extension with `version` field from frontmatter

### Phase 4: Catalog in Upgrade Output

- `vlurp upgrade` output includes inline catalog diff
- Upgrade summary shows new/removed/changed skills with surface area deltas
- `vlurp upgrade --dry-run` output matches upgrade output format

## Why catalogs, not changelogs

gstack's upgrade flow reads `CHANGELOG.md` and asks an LLM to summarize it. This has three problems:

1. **CHANGELOG.md is optional.** Many repos don't have one. Many that do don't maintain it.
2. **Summarization is lossy.** An LLM summary might miss a new tool reference or downplay a removed capability.
3. **It's not machine-readable.** You can't pipe a CHANGELOG summary into a CI gate.

Catalog diffs solve all three:

1. **Catalogs are derived from content.** If the SKILL.md files exist, the catalog exists. No author discipline required.
2. **Diffs are exact.** A new tool in `tool_surface` shows up as `+Bash`. A removed skill shows up as `(removed)`. No interpretation needed.
3. **JSON output is first-class.** `vlurp catalog-diff --json` is directly consumable by any automation.

The catalog is what the skill pack IS -- its capabilities, surfaces, and structure. The catalog diff is what CHANGED. That is a more useful changelog than any human-written prose.
