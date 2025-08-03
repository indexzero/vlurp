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
