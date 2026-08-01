```
  |   ._._
\/||_|| |_)
        |
```

Fetch text from GitHub. Pin to commits. Hash every file. Scan for threats. Diff before you accept.

vlurp is not a package manager. It does not resolve dependencies, run install scripts, or manage a registry. It fetches files from GitHub repos, tracks where they came from, and tells you what they do -- so you can make informed trust decisions about text that becomes AI agent instructions.

## Install

```sh
npm install -g vlurp
```

or run directly:

```sh
npx vlurp mattpocock/skills --preset skills
```

## Quick start

The easy case is repository shorthand. Fetch the useful skill files from a repository with a maintained preset:

```sh
vlurp mattpocock/skills --preset skills
```

This writes the selected repository content beneath `./mattpocock/skills`. Pin it to a commit when you want a reproducible fetch:

```sh
vlurp mattpocock/skills --preset skills --ref 2ab9580
```

Use `-d` to choose an output root, `--as` to give the fetched directory a specific name, or `--filter` for repository-relative patterns:

```sh
vlurp mattpocock/skills -d ./vendor --preset skills
vlurp mattpocock/skills -d ./skills --as writing --filter 'skills/in-progress/writing-*'
```

When you need exact remote sources and `cp` placement, use PURL operands. This copies matching directories directly into `./skills/`:

```
$ vlurp 'pkg:github/mattpocock/skills#skills/in-progress/writing-*' ./skills/

  ./skills/writing-beats/
  ./skills/writing-fragments/
  ./skills/writing-shape/
```

Embed the ref in the PURL to pin the same copy:

```
$ vlurp 'pkg:github/mattpocock/skills@2ab9580#skills/in-progress/writing-*' ./skills/
```

The command follows familiar `cp SOURCE... DEST` rules. A selected directory or file is copied by basename into an existing destination directory. If a single source is copied to a missing destination, that destination becomes the copy.

Copy multiple exact sources:

```sh
vlurp \
  'pkg:github/anthropics/skills@main#skills/pdf' \
  'pkg:github/anthropics/skills@main#skills/slides' \
  ./skills/
```

## Presets

Presets are a first-class way to fetch common repository structures without spelling out globs. They work with both repository shorthand and the cp-style interface:

```sh
vlurp obra/superpowers --preset skills -d ./.claude/skills --ref e4f5a6b
vlurp eyaltoledano/claude-task-master --preset claude -d ./config
vlurp 'pkg:github/obra/superpowers' ./.claude/skills --preset skills
```

| Preset | Selects |
|--------|---------|
| `claude` | `.claude/**`, `CLAUDE.md` |
| `skills` | `skills/**`, `SKILL.md`, Markdown support files |
| `agents` | `agents/**`, `commands/**`, Markdown support files |
| `docs` | Markdown documentation excluding boilerplate |
| `all-md` | All Markdown files |
| `minimal` | Only `.claude/**` and `CLAUDE.md` |

With cp-style operands, a preset filters the files beneath each selected source without changing where that source is placed. Add `--glob` or `--iglob` to refine a preset; explicit patterns are applied after the preset.

```sh
vlurp 'pkg:github/obra/superpowers#skills' ./skills \
  --preset skills \
  --glob '!**/experimental/**'
```

`--glob` is case-sensitive and `--iglob` is case-insensitive. Both are repeatable. A leading `!` excludes matches. If any positive pattern is present, unmatched files are excluded; with exclusion-only patterns, unmatched files remain included.

Check that nothing has been modified since you fetched:

```
$ vlurp verify .claude/skills

  obra/superpowers/skills/tdd/SKILL.md                ok  sha256:e3b0c442
  obra/superpowers/skills/verify/SKILL.md             ok  sha256:7f83b165
  duckdb/SKILL.md                                     ok  sha256:13681909

  25 files verified, 0 modified
```

See what a skill tells your agent to do before you inject it:

```
$ vlurp scan .claude/skills

  obra/superpowers/skills/tdd/SKILL.md
    ok   No injection patterns
    warn Bash (8 refs), Edit (4 refs)

  duckdb/SKILL.md
    ok   No injection patterns
    warn Bash (11 refs)
    warn References external commands: duckdb

  25 files, 0 issues, 12 warnings
  tool surface: Bash (31), Read (8), Edit (6)
  command surface: duckdb, git, npm
```

Upgrade when upstream changes, with a structured diff of what's new:

```
$ vlurp upgrade --dry-run

  obra/superpowers  e4f5a6b -> 9c8b7a6

    tdd            1.0.0 -> 1.0.1
      tools:       (unchanged)
      files:       (unchanged)

    debug          (new skill)
      tools:       Bash, Read, Grep

  1 source, 8 skills (1 new, 1 changed, 6 unchanged)
```

## Batch

Process multiple repos from a `.vlurpfile`:

```sh
# .vlurpfile

# Official Anthropic skills
vlurp 'pkg:github/anthropics/skills@b7c8d9e#skills/*' ./skills/

# obra/superpowers -- Core agent patterns
vlurp obra/superpowers --preset skills -d ./skills --ref e4f5a6b

# Microsoft Amplifier -- multi-agent framework
vlurp 'pkg:github/microsoft/amplifier@4a5b6c7#**/*.md' ./docs/
```

```
$ vlurp batch .vlurpfile
```

## Commands

```
vlurp REPOSITORY [options]           Fetch a repository using shorthand
vlurp REPOSITORY --preset NAME       Fetch using a named selection preset
vlurp SOURCE... DEST                 Copy precise PURL sources into local files
vlurp SOURCE... DEST --preset NAME   Copy PURL sources using a preset
vlurp batch <vlurpfile>              Process a .vlurpfile (batch fetch)
vlurp verify <path>                  Check file integrity against lineage
vlurp pin [source]                   Pin sources to current upstream HEAD
vlurp outdated [vlurpfile]           Check for upstream changes
vlurp diff <source>                  Content diff against upstream
vlurp scan <path>                    Analyze for injection/escalation patterns
vlurp catalog <path>                 Generate skill index (catalog.json)
vlurp upgrade [source]               Upgrade outdated sources
vlurp catalog-diff [old] [new]       Compare catalog snapshots
```

## Flags

```
-d <dir>              Root output directory for repository selection mode
--ref <sha|tag>       Pin a repository-mode fetch to a Git ref
--as <name>           Override its output directory name
--preset <name>       Apply a maintained named selection preset
--glob <pattern>      Apply a case-sensitive cp transfer pattern
--iglob <pattern>     Apply a case-insensitive cp transfer pattern
--filter <glob>       Add repository-mode selection patterns
--auto                Detect a suitable repository preset
--dry-run, -n         Preview without writing
--force, -f           Overwrite without prompting
--json                Machine-readable output (catalog-diff)
--vlurpfile <path>    Explicit .vlurpfile path (upgrade)
```

PURL operands determine remote sources and local placement. `--preset`, `--glob`, and `--iglob` determine the files transferred beneath those sources. Repository shorthand with `--preset` or `--filter` remains supported.

## Feature guides

| Guide | Covers |
|-------|--------|
| **[Fetching and Copying](doc/fetch.md)** | Repository shorthand, presets, PURL sources, refs, and cp semantics |
| **[The .vlurpfile](doc/vlurpfile.md)** | Batch processing, manifest format, intent vs reality |
| **[Supply Chain Security](doc/supply-chain.md)** | Lineage, verify, pin, scan, threat model |
| **[Upgrades & Change Detection](doc/upgrade.md)** | outdated, diff, upgrade, catalog, catalog-diff |

## Data files

```
.vlurpfile       Fetch intent. One vlurp command per line. Human-authored.
.vlurp.jsonl     Lineage. SHA-256 hashes, provenance, scan results. Machine-generated.
.vlurp.sigstore  Sigstore attestation bundle (optional). Cryptographic proof of fetch.
catalog.json     Derived skill index. Names, tools, commands, supporting files.
```

The `.vlurpfile` is intent -- what you want. The `.vlurp.jsonl` is reality -- what you got. Both are committed to git. Both are reviewed in PRs. Separately.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache-2.0](LICENSE)
