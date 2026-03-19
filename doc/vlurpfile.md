# The .vlurpfile

A `.vlurpfile` is a manifest of fetch commands. One vlurp invocation per line, comments with `#`. It is a shell script you can also run manually. It is human-readable, human-editable, and greppable.

It is not a `package.json`. There is no dependency resolution. There are no lifecycle hooks. There is no semver. Each line is an independent fetch operation.

## Format

```sh
# .vlurpfile -- Agent skill sources, reviewed and pinned

# obra/superpowers -- Core agent patterns
vlurp obra/superpowers -d .claude/skills --preset skills --ref e4f5a6b

# whilp/dotfiles -- DuckDB skills
vlurp whilp/dotfiles -d .claude/skills --filter ".claude/skills/duckdb-json/**" --as duckdb --ref 6fc9349

# eyaltoledano/claude-task-master -- Task management
vlurp eyaltoledano/claude-task-master -d .claude/skills --preset claude --ref 29e67fa
```

Rules:

- Lines starting with `#` are comments
- Blank lines are ignored
- Each command line is a complete `vlurp` invocation
- Arguments are parsed the same way as the CLI
- You can run any line by itself: copy it, paste it into your terminal

## Batch processing

`vlurp batch` processes an entire `.vlurpfile`:

```sh
vlurp batch .vlurpfile
```

Each line executes in sequence. Progress is reported per-source. If a source fails, vlurp continues with the remaining sources and reports failures at the end.

Preview what would happen without writing anything:

```sh
vlurp batch .vlurpfile --dry-run
```

Force overwrite existing content:

```sh
vlurp batch .vlurpfile --force
```

## File naming conventions

You can name your vlurpfile anything. Common conventions:

```
.vlurpfile              Default
.vlurpfile.skills       Skills only
.vlurpfile.claude       Claude Code configuration
.vlurpfile.team         Shared team configuration
```

vlurp looks for `.vlurpfile` by default when running `vlurp upgrade` or `vlurp pin` without an explicit path.

## Intent vs reality

The `.vlurpfile` records **intent**: what you want to fetch, from where, with what filters and pins.

The `.vlurp.jsonl` records **reality**: what was actually fetched, when, with what SHA-256 hashes.

```
.vlurpfile       "fetch obra/superpowers at ref e4f5a6b with preset skills"
.vlurp.jsonl     "fetched obra/superpowers at e4f5a6b on 2026-03-15, got 22 files, here are the hashes"
```

Both files are committed to git. Both are reviewed in PRs. The `.vlurpfile` is reviewed for intent ("should we add this source?"). The `.vlurp.jsonl` is reviewed for integrity ("did the fetch produce what we expected?"). They answer different questions.

Some tools use a lock file that stores a hash from the GitHub Trees API -- not a hash of the content that was actually written to disk. That is a receipt for what the server said, not proof of what you have. vlurp hashes the files after extraction. The `.vlurp.jsonl` describes reality.

## Editing

You can edit a `.vlurpfile` with any text editor. It's a text file.

To pin all unpinned sources to the current upstream HEAD:

```sh
vlurp pin
```

To upgrade all sources to the latest upstream and update their `--ref` values:

```sh
vlurp upgrade
```

Both commands rewrite the `.vlurpfile` in place, preserving comments, blank lines, and argument ordering. See [Upgrades & Change Detection](upgrade.md) for details.

## Example: real-world vlurpfile

```sh
# .vlurpfile -- Production agent skills
# Last reviewed: 2026-03-15 by @indexzero
#
# Review checklist:
#   1. vlurp batch .vlurpfile --dry-run
#   2. vlurp scan .claude/skills
#   3. git diff .vlurp.jsonl

# Official Anthropic skills
vlurp anthropics/skills -d .claude/skills --filter "skills/**" --filter "template/**" --ref b7c8d9e

# Core agent patterns (obra)
vlurp obra/superpowers -d .claude/skills --filter "skills/**" --filter ".claude/**" --ref e4f5a6b

# DuckDB skills from assorted dotfiles
vlurp whilp/dotfiles -d .claude/skills --filter ".claude/skills/duckdb-json/**" --as duckdb --ref 6fc9349
vlurp PovertyAction/ipa-research-data-science-hub -d .claude/skills --filter ".claude/skills/duckdb/**" --as duckdb-ipa

# Microsoft Amplifier -- multi-agent framework
vlurp microsoft/amplifier -d .claude/skills --filter "**/*.md" --ref 4a5b6c7
```

The comment block at the top is a review checklist. When this file changes in a PR, the reviewer runs those three commands. The `.vlurpfile` is the table of contents. The `.vlurp.jsonl` diff in the same PR is the proof that the content matches.
