# The .vlurpfile

A `.vlurpfile` is a manifest of copy commands. Each non-comment line is a complete vlurp invocation that can also be pasted into a terminal.

It is not a package manifest: there is no dependency resolution, registry, semver solving, or lifecycle execution.

## Format

```sh
# .vlurpfile -- reviewed and pinned remote files

vlurp 'pkg:github/anthropics/skills@b7c8d9e#skills/*' ./.claude/skills/
vlurp 'pkg:github/obra/superpowers@e4f5a6b#skills' ./skills/ --preset skills --glob '!**/drafts/**'
vlurp obra/superpowers --preset skills -d ./.claude/skills --ref e4f5a6b
vlurp 'pkg:github/whilp/dotfiles@6fc9349#.claude/skills/duckdb-json' ./skills/
```

Rules:

- Lines starting with `#` and blank lines are ignored.
- PURL copy entries have `SOURCE... DEST` operands followed by repeatable `--glob` and `--iglob` patterns or `--preset`.
- Repository entries may use named presets, filters, and their existing output options.
- Both single and double quotes are supported.
- Patterned PURLs should be quoted for parity with commands pasted into a shell.
- `--force`, `--quiet`, and `--dry-run` are valid invocation flags.
- Presets work in both PURL copy and repository shorthand entries.

## Running a .vlurpfile

Pass the file as the operand:

```sh
vlurp ./.vlurpfile
vlurp ./.vlurpfile --dry-run
vlurp ./.vlurpfile --force
vlurp ./skills/kabocha/.vlurpfile
```

Entries run sequentially. A failed entry is reported without preventing later entries from running.

Relative paths in a `.vlurpfile` (`DEST`, `-d`, and `--as`) resolve from the directory that contains the `.vlurpfile`, not from your current directory. `vlurp ./skills/kabocha/.vlurpfile` writes the same files whether you run it from the repository root or from `skills/kabocha`. `upgrade`, `pin`, and `outdated` read paths the same way.

Any operand that starts with `.`, `/`, or `~`, or that names an existing file, is a local file. GitHub owners cannot start with those characters, so this never shadows `owner/repo` shorthand. vlurp reads the file to decide what to do: if the first non-blank, non-comment line is a JSON object, the file is lineage and vlurp restores from it (see [Restore from lineage](#restore-from-lineage)); otherwise it runs as a `.vlurpfile`.

## Intent and reality

The `.vlurpfile` records intent: remote identities, selected paths, refs, and local destinations. `.vlurp.jsonl` records reality: the source operand, fetch time, destination-relative paths, and hashes of the bytes written.

Commit both. Review the `.vlurpfile` for what should be copied and lineage for what was copied.

## Restore from lineage

Lineage is also a record of what is safe to fetch. A repository can commit only `.vlurp.jsonl`, gitignore the content beside it, and fetch the content on demand:

```gitignore
# Keep the lineage; restore the content from it
references/of-structure/*
!references/of-structure/.vlurp.jsonl
```

```sh
vlurp ./references/of-structure/.vlurp.jsonl            # fetch missing files
vlurp ./references/of-structure/.vlurp.jsonl --dry-run  # report only; no network
vlurp ./references/of-structure/.vlurp.jsonl --force    # also replace local edits
```

Ignore the directory's contents (`dir/*`), not the directory itself (`dir/`). Git cannot re-include `.vlurp.jsonl` when its parent directory is ignored.

Restore does not replay the `.vlurpfile` command. Each record's `files` keys are the layout, and each file's bytes come from whichever file inside the record's PURL selection, at the recorded ref, has the recorded sha256:

- Only the paths listed in the record are written, relative to the directory that holds `.vlurp.jsonl`. Absolute paths, `..` segments, symbolic links, and special files are refused.
- Every file in every record is fetched and checked before anything is written. If one file no longer matches upstream, nothing is written.
- A file whose hash already matches is reported `unchanged` and left alone. A file that differs is reported `modified`, and the restore fails unless `--force` is set.
- An unpinned record (no `@ref`) is fetched from the default branch with a warning; its hashes are still enforced.
- `.vlurp.jsonl` itself is never written or reformatted.

Only schema 2 lineage, which PURL copies write, can be restored. vlurp rejects older repository-shorthand records and tells you to copy the content again with a `pkg:github/...` source.

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
vlurp ./.vlurpfile --dry-run
vlurp ./.vlurpfile
vlurp verify ./skills
vlurp scan ./skills
git diff -- .vlurpfile skills/.vlurp.jsonl
```

The dry run shows concrete remote matches and destination paths. Verification checks the resulting bytes; scanning describes the instruction and tool surface.
