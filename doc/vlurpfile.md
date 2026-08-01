# The .vlurpfile

A `.vlurpfile` is a manifest of copy commands. Each non-comment line is a complete vlurp invocation that can also be pasted into a terminal.

It is not a package manifest: there is no dependency resolution, registry, semver solving, or lifecycle execution.

## Format

```sh
# .vlurpfile -- reviewed and pinned remote files

vlurp 'pkg:github/anthropics/skills@b7c8d9e#skills/*' ./.claude/skills/
vlurp 'pkg:github/obra/superpowers@e4f5a6b#skills/*' ./.claude/skills/
vlurp 'pkg:github/whilp/dotfiles@6fc9349#.claude/skills/duckdb-json' ./skills/
```

Rules:

- Lines starting with `#` and blank lines are ignored.
- Each command has `SOURCE... DEST` operands followed by options.
- Both single and double quotes are supported.
- Patterned PURLs should be quoted for parity with commands pasted into a shell.
- `--force`, `--quiet`, and `--dry-run` are valid invocation flags.
- Legacy v2 entries remain parseable during migration.

## Batch processing

```sh
vlurp batch .vlurpfile
vlurp batch .vlurpfile --dry-run
vlurp batch .vlurpfile --force
```

Entries run sequentially. A failed entry is reported without preventing later entries from running.

## Intent and reality

The `.vlurpfile` records intent: remote identities, selected paths, refs, and local destinations. `.vlurp.jsonl` records reality: the source operand, fetch time, destination-relative paths, and hashes of the bytes written.

Commit both. Review the `.vlurpfile` for what should be copied and lineage for what was copied.

## Pin and upgrade

`vlurp pin` resolves the default-branch HEAD for each unpinned PURL and embeds the short commit in `@ref`:

```diff
-vlurp 'pkg:github/obra/superpowers#skills/*' ./skills/
+vlurp 'pkg:github/obra/superpowers@e4f5a6b#skills/*' ./skills/
```

`vlurp upgrade` compares embedded refs with upstream HEAD, reruns the same copy plan, and updates each affected PURL in place. Comments, whitespace, quoting, destinations, and subpaths are preserved.

```sh
vlurp pin
vlurp outdated .vlurpfile
vlurp upgrade --dry-run
vlurp upgrade
```

When one command contains sources from multiple repositories, each source is pinned and upgraded independently.

## Recommended review workflow

```sh
vlurp batch .vlurpfile --dry-run
vlurp batch .vlurpfile
vlurp verify ./skills
vlurp scan ./skills
git diff -- .vlurpfile skills/.vlurp.jsonl
```

The dry run shows concrete remote matches and destination paths. Verification checks the resulting bytes; scanning describes the instruction and tool surface.
