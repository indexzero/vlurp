# Upgrades & Change Detection

vlurp fetches, pins, and verifies. But upstream repos change. Authors push new skills, update existing ones, remove deprecated files. You need to know what changed, decide whether to accept it, and apply the update without losing your audit trail.

Some tools upgrade by running `git reset --hard origin/main` followed by a shell script that compiles binaries and creates symlinks. That is an `npm postinstall` script by another name. The upstream repo author decides what code runs on your machine after every upgrade. vlurp does not execute anything. Upgrading is fetching with better UX. No lifecycle hooks. No setup scripts. No trust escalation. Files are files.

## Check what's outdated

`vlurp outdated` compares your pinned refs against the current upstream HEAD:

```
$ vlurp outdated .vlurpfile

  obra/superpowers (pinned: e4f5a6b, upstream: 9c8b7a6)
    3 files changed, 1 file added

  whilp/dotfiles (pinned: 6fc9349)
    up to date

  microsoft/amplifier (pinned: 4a5b6c7, upstream: d3e2f1a)
    1 file changed

  2 of 3 sources outdated
```

This is a read-only check. It resolves upstream HEAD via the GitHub API and compares against your `.vlurpfile` pins. Nothing is fetched, nothing is modified.

Exit code 0 if everything is current. Exit code 1 if any source is outdated.

## Content diff

`vlurp diff` shows what actually changed in the upstream content:

```
$ vlurp diff obra/superpowers -d .claude/skills

  --- obra/superpowers/skills/tdd/SKILL.md (local, e4f5a6b)
  +++ obra/superpowers/skills/tdd/SKILL.md (upstream, 9c8b7a6)
  @@ -42,6 +42,12 @@
   ## Running tests
  +
  +### Parallel execution
  +
  +Run tests with maximum parallelism:
  +```bash
  +npm test -- --parallel
  +```
```

This fetches the upstream tarball to a temp directory, applies your filters, and diffs against your local files. Temp content is discarded after diffing. Nothing is modified.

This is `terraform plan` for your agent context. You see what would change before you accept it.

## Upgrade

`vlurp upgrade` is the atomic operation that combines outdated checking, fetching, cataloging, and vlurpfile rewriting:

```sh
# Upgrade all outdated sources
vlurp upgrade

# Upgrade a specific source
vlurp upgrade obra/superpowers

# Preview without modifying anything
vlurp upgrade --dry-run

# Explicit vlurpfile path
vlurp upgrade --vlurpfile .vlurpfile.skills
```

### What upgrade does

1. **Reads** `.vlurpfile` (intent) and `.vlurp.jsonl` (current state)
2. **Resolves** upstream HEAD for each source via GitHub API
3. **Compares** against pinned refs to find outdated sources
4. **Fetches** new content through the standard pipeline (download, extract, filter, hash, scan)
5. **Catalogs** new content and diffs against the previous catalog
6. **Rewrites** `.vlurpfile` with updated `--ref` values
7. **Outputs** upgrade summary with catalog diff

The fetch pipeline is the same one used by `vlurp fetch` and `vlurp batch`. Upgraded content gets hashed, lineage gets written, scans run. No shortcuts.

### Dry run

`vlurp upgrade --dry-run` performs steps 1-3, fetches upstream to a temp directory, catalogs and diffs, then discards everything. No files are modified. No `.vlurpfile` changes. No `.vlurp.jsonl` updates. You see exactly what would change.

```
$ vlurp upgrade --dry-run

  obra/superpowers  e4f5a6b -> 9c8b7a6

    tdd            1.0.0 -> 1.0.1
      tools:       (unchanged)
      files:       (unchanged)

    debug          (new skill)
      tools:       Bash, Read, Grep
      commands:    node, npm

  microsoft/amplifier  4a5b6c7 -> d3e2f1a

    CLAUDE.md      (changed)
      tools:       +WebFetch
      files:       +docs/agent-patterns.md

  2 sources, 8 skills (1 new, 2 changed, 5 unchanged)
```

### Vlurpfile rewriting

`vlurp upgrade` rewrites the `.vlurpfile` to update `--ref` values. If a source had no `--ref`, one is added. Comments, blank lines, and argument ordering are preserved.

Before:

```sh
# Core agent patterns
vlurp obra/superpowers -d .claude/skills --preset skills --ref e4f5a6b

# Multi-agent framework
vlurp microsoft/amplifier -d .claude/skills --filter "**/*.md"
```

After `vlurp upgrade`:

```sh
# Core agent patterns
vlurp obra/superpowers -d .claude/skills --preset skills --ref 9c8b7a6

# Multi-agent framework
vlurp microsoft/amplifier -d .claude/skills --filter "**/*.md" --ref d3e2f1a
```

The superpowers entry's ref was updated. The amplifier entry gained a ref -- it was previously unpinned, now pinned to the version that was fetched.

## Skill catalog

`vlurp catalog` reads fetched content and produces `catalog.json` -- a derived index of every skill with its metadata:

```sh
vlurp catalog .claude/skills
```

```json
{
  "generated_at": "2026-03-15T06:00:00Z",
  "vlurp_version": "2.0.0",
  "skills": {
    "tdd": {
      "source": "github:obra/superpowers",
      "ref": "9c8b7a6",
      "path": "obra/superpowers/skills/tdd/SKILL.md",
      "name": "tdd",
      "version": "1.0.1",
      "description": "Test-driven development workflow",
      "tool_surface": ["Bash", "Read", "Edit"],
      "command_surface": ["npm", "node"],
      "supporting_files": ["examples.md"],
      "fetched_at": "2026-03-15T06:00:00Z"
    }
  }
}
```

The catalog is **derived**, not authored. It is regenerated from content on disk by vlurp's own code. No upstream-authored scripts execute. No template engines process files. The catalog reflects what is actually on disk, not what a remote API claims.

Fields are extracted from YAML frontmatter and content analysis:

- `name`, `description`, `version`: from frontmatter
- `tool_surface`: agent tools referenced in the content (Bash, Read, Edit, etc.)
- `command_surface`: external commands found in code blocks
- `supporting_files`: non-SKILL.md files in the same directory

## Catalog diff

`vlurp catalog-diff` compares two catalog snapshots and reports what changed at the skill level:

```sh
# Compare catalog.prev.json vs catalog.json (default)
vlurp catalog-diff

# Explicit paths
vlurp catalog-diff old-catalog.json new-catalog.json

# Machine-readable output
vlurp catalog-diff --json
```

```
obra/superpowers  e4f5a6b -> 9c8b7a6

  tdd        1.0.0 -> 1.0.1
    tools:    (unchanged)
    commands: (unchanged)
    files:    (unchanged)

  debug      (new skill)
    tools:    Bash, Read, Grep
    commands: node, npm

  verify     1.0.0 -> 1.0.0
    tools:    (unchanged)
    commands: (unchanged)
    files:    +checklist.md

  old-skill  (removed)

Summary: 1 source, 6 skills (1 new, 1 removed, 1 changed, 3 unchanged)
```

### Diff categories

| Category | Meaning |
|----------|---------|
| **new** | Present in new catalog, absent in old |
| **removed** | Present in old catalog, absent in new |
| **changed** | Present in both, any field differs |
| **unchanged** | Present in both, all fields identical |

For changed skills, the diff reports which fields changed:

- `version`: old -> new
- `tool_surface`: +added, -removed
- `command_surface`: +added, -removed
- `supporting_files`: +added, -removed

### Machine-readable output

`vlurp catalog-diff --json` produces output consumable by CI pipelines, Claude Code hooks, or any automation:

```json
{
  "skills": {
    "tdd": {
      "status": "changed",
      "version": { "old": "1.0.0", "new": "1.0.1" },
      "tool_surface": { "added": [], "removed": [] },
      "supporting_files": { "added": [], "removed": [] }
    },
    "debug": {
      "status": "new",
      "tool_surface": { "added": ["Bash", "Read", "Grep"], "removed": [] }
    }
  },
  "summary": { "total": 6, "new": 1, "removed": 1, "changed": 1, "unchanged": 3 }
}
```

### Why catalogs, not changelogs

Some tools read `CHANGELOG.md` and ask an LLM to summarize it. This has three problems: changelogs are optional, LLM summaries are lossy, and prose is not machine-readable.

Catalog diffs are none of these things. If the SKILL.md files exist, the catalog exists -- no author discipline required. A new tool in `tool_surface` shows up as `+Bash`, not as a paragraph that might bury the lead. And `--json` output pipes directly into any CI gate.

The catalog is what a skill pack IS -- its capabilities, surfaces, and structure. The catalog diff is what CHANGED. That is a more useful changelog than any human-written prose or any LLM summary of human-written prose.

## Workflow

A typical upgrade workflow:

```sh
# 1. See what's outdated
vlurp outdated .vlurpfile

# 2. Preview the changes
vlurp upgrade --dry-run

# 3. Apply the upgrade
vlurp upgrade

# 4. Verify the result
vlurp verify .claude/skills

# 5. Review and commit
git diff .vlurpfile .vlurp.jsonl catalog.json
git add -A && git commit -m "chore: upgrade skill packs"
```

Each step produces evidence that the next step can verify. The dry run shows what would change. The upgrade applies it. The verify confirms integrity. The git diff shows the reviewer exactly what happened. At every step, a human is looking at output and making a decision.
