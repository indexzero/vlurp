# Fetching & Filtering

vlurp fetches files from GitHub repositories and gists. It downloads tarballs -- not git clones -- so you get files without history, without `.git` directories, and without executing anything on your machine.

You do not need a forty-nine step installer to get a text file onto your disk.

## Sources

vlurp accepts three source formats:

```sh
# user/repo shorthand
vlurp obra/superpowers

# Full GitHub URL
vlurp https://github.com/microsoft/amplifier

# Gist URL
vlurp https://gist.github.com/user/abc123def456
```

All three produce the same result: files on disk.

## Output directory

By default, vlurp writes to `./<user>/<repo>`. Use `-d` to set a root directory:

```sh
vlurp obra/superpowers -d .claude/skills
# writes to .claude/skills/obra/superpowers/
```

Use `--as` to flatten the path:

```sh
vlurp obra/superpowers -d .claude/skills --as superpowers
# writes to .claude/skills/superpowers/
```

`--as` strips the `owner/repo` prefix and all internal path nesting. When you're fetching skill files from deep inside a repo's directory tree, `--as` puts them where you can find them.

```sh
vlurp whilp/dotfiles -d ./skills --filter ".claude/skills/duckdb-json/**" --as duckdb
# instead of: ./skills/whilp/dotfiles/.claude/skills/duckdb-json/SKILL.md
# you get:    ./skills/duckdb/SKILL.md
```

## Filtering

By default, vlurp matches a broad set of agent-relevant files: `.claude/**`, `CLAUDE.md`, `**/*.md`, `agents/**`, `commands/**`. Use `--filter` to override:

```sh
# Only TypeScript files
vlurp user/repo --filter "*.ts" --filter "*.tsx"

# Only a specific directory
vlurp user/repo --filter "lib/**"

# Combine inclusions and exclusions
vlurp user/repo --filter "**/*.md" --filter "!README.md"
```

`--filter` accepts glob patterns. Prefix with `!` to exclude. Multiple `--filter` flags are combined.

## Presets

Presets are named filter sets for common repo structures:

```
claude      .claude/**, CLAUDE.md
skills      skills/**, SKILL.md, **/*.md
agents      agents/**, commands/**, **/*.md
docs        **/*.md (excluding boilerplate)
all-md      **/*.md
minimal     .claude/**, CLAUDE.md only
```

```sh
vlurp obra/superpowers --preset skills
vlurp eyaltoledano/claude-task-master --preset claude
```

Presets exclude boilerplate by default (README.md, LICENSE, CONTRIBUTING.md, etc.). If you want everything, use `all-md` or explicit `--filter` globs.

## Auto-detect

`--auto` inspects the tarball contents and picks the best preset:

```sh
vlurp microsoft/amplifier --auto
```

If the repo has a `.claude/` directory, `--auto` uses `claude`. If it has `skills/` or `SKILL.md` files, it uses `skills`. Otherwise it falls back to the default filter set.

## Pinning with `--ref`

`--ref` pins a fetch to a specific git commit, tag, or branch:

```sh
vlurp obra/superpowers --ref e4f5a6b
vlurp anthropics/skills --ref v1.2.0
vlurp microsoft/amplifier --ref main
```

When `--ref` is a commit SHA, the fetch is immutable. The same SHA always produces the same content. This is the foundation of everything in vlurp's security model.

When `--ref` is omitted, vlurp fetches the default branch HEAD. This is the mutable case. Whatever the author pushed most recently is what you get. If the author pushed a malicious change thirty seconds ago, you have it. Pin your refs.

## Dry run

`--dry-run` shows what would be fetched without writing anything:

```sh
$ vlurp obra/superpowers --preset skills --dry-run

  obra/superpowers@HEAD
  would fetch 22 files (preset: skills)
  would write to ./obra/superpowers/
```

## Lineage

Every fetch produces a lineage record in `.vlurp.jsonl` with SHA-256 hashes of every file. This happens automatically. See [Supply Chain Security](supply-chain.md) for details.

## Scanning

Fetched content is scanned for prompt injection, tool escalation, and exfiltration patterns by default. See [Supply Chain Security](supply-chain.md) for details.
