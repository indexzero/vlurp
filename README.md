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
npx vlurp <user>/<repo>
```

## Quick start

Fetch a repo's Claude config:

```
$ vlurp eyaltoledano/claude-task-master -d ./vlurp

  eyaltoledano/claude-task-master@HEAD
  2 files
  ./vlurp/eyaltoledano/claude-task-master/
```

Fetch skill files pinned to a commit, flattened into a named directory:

```
$ vlurp obra/superpowers -d .claude/skills --preset skills --ref e4f5a6b

  obra/superpowers@e4f5a6b
  22 files (preset: skills)
  .claude/skills/obra/superpowers/
```

Fetch a specific directory from deep inside a repo:

```
$ vlurp whilp/dotfiles -d .claude/skills \
    --filter ".claude/skills/duckdb-json/**" --as duckdb

  whilp/dotfiles@HEAD
  3 files
  .claude/skills/duckdb/
```

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
vlurp anthropics/skills -d ./vlurp --filter "skills/**" --filter "template/**"

# obra/superpowers -- Core agent patterns
vlurp obra/superpowers -d ./vlurp --filter "skills/**" --filter ".claude/**"

# DuckDB skills from assorted dotfiles
vlurp whilp/dotfiles -d ./vlurp --filter ".claude/skills/duckdb-json/**"
vlurp PovertyAction/ipa-research-data-science-hub -d ./vlurp --filter ".claude/skills/duckdb/**"

# Microsoft Amplifier -- multi-agent framework
vlurp microsoft/amplifier -d ./vlurp --filter "**/*.md"
```

```
$ vlurp batch .vlurpfile
```

## Commands

```
vlurp <source>                       Fetch from a GitHub repo or gist
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
-d <dir>              Root output directory
--ref <sha|tag>       Pin to a git ref (commit, tag, branch)
--as <name>           Flatten output into named directory
--preset <name>       Use a preset filter set
--filter <glob>       Glob pattern for file matching (repeatable)
--auto                Auto-detect repo structure
--dry-run, -n         Preview without writing
--force, -f           Overwrite without prompting
--json                Machine-readable output (catalog-diff)
--vlurpfile <path>    Explicit .vlurpfile path (upgrade)
```

## Presets

```
claude      .claude/**, CLAUDE.md
skills      skills/**, SKILL.md, **/*.md
agents      agents/**, commands/**, **/*.md
docs        **/*.md (excluding boilerplate)
all-md      **/*.md
minimal     .claude/**, CLAUDE.md only
```

## Feature guides

| Guide | Covers |
|-------|--------|
| **[Fetching & Filtering](doc/fetch.md)** | Sources, globs, presets, `--ref`, `--as`, `--auto` |
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
