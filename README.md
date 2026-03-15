# `vlurp === (vibes && slurp) // true`

A fun CLI tool to quickly slurp vibe(ish) files from GitHub repositories and gists.

## Installation

```sh
# Install globally
npm install -g vlurp

# Or with pnpm
pnpm add -g vlurp

# Or run directly with npx
npx vlurp <user>/<repo>
```

## Usage

```sh
# vlurp a repository using user/repo format
vlurp cool-repo/has-agents
# → Creates ./cool-repo/has-agents

# vlurp to a specific directory
vlurp cool-repo/has-agents -d ~/projects
# → Creates ~/projects/cool-repo/has-agents

# vlurp using a GitHub URL
vlurp https://github.com/whoever/cool-configs
# → Creates ./whoever/cool-configs

# vlurp a GitHub Gist
vlurp https://gist.github.com/user/abc123def456
# → Creates ./user/abc123def456

# Show help
vlurp --help

# Filter files (default: .claude/** and CLAUDE.md)
vlurp cool-repo/has-agents --filter "*.ts" --filter "*.tsx"

# vlurp only specific directories
vlurp whoever/cool-configs --filter "lib/**" --filter "doc/**"

# vlurp only markdown files
vlurp user/repo --filter "*.md"

# Use a preset instead of manual filters
vlurp user/repo --preset claude
vlurp user/repo --preset skills

# Auto-detect repo structure and apply appropriate filters
vlurp user/repo --auto

# Preview what would be fetched
vlurp user/repo --dry-run

# Process a .vlurpfile
vlurp batch .vlurpfile
vlurp batch .vlurpfile --dry-run
```

## Presets

| Preset | Description | Filters |
|--------|-------------|---------|
| `claude` | Claude Code config | `.claude/**`, `CLAUDE.md` |
| `skills` | Agent skills | `skills/**`, `SKILL.md`, `**/*.md` |
| `agents` | Agent definitions | `agents/**`, `commands/**`, `**/*.md` |
| `docs` | Documentation | `**/*.md` (excluding boilerplate) |
| `all-md` | All markdown | `**/*.md` |
| `minimal` | Minimal claude | `.claude/**`, `CLAUDE.md` only |

## Batch Processing

Process multiple repos from a `.vlurpfile`:

```bash
vlurp batch .vlurpfile
```

Example `.vlurpfile`:
```bash
# Comments start with #
vlurp anthropics/skills -d ./vlurp --preset skills
vlurp obra/superpowers -d ./vlurp --preset claude
vlurp user/repo -d ./vlurp --filter "docs/**"
```

## Features

- 🚀 Fast - Downloads tarballs instead of cloning entire git history
- 📦 Lightweight - Minimal dependencies
- 🎨 Clean output with progress indicators
- 🔒 Only works with github.com and gist.github.com
- 🌈 Simple - Just pass a repo or URL and go!
- 🎯 Selective - Filter files with glob patterns (defaults to .claude/** and CLAUDE.md)

## Contributing

Please see our [Contributing Guide](CONTRIBUTING.md) for details on how to contribute to this project.

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.
