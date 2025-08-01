# `vlurp === (vibes && slurp) // true`

A fun CLI tool to quickly clone GitHub repositories and gists without using git.

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
# Clone a repository using user/repo format
vlurp cool-repo/has-agents
# → Creates ./cool-repo/has-agents

# Clone to a specific directory
vlurp cool-repo/has-agents -d ~/projects
# → Creates ~/projects/cool-repo/has-agents

# Clone using a GitHub URL
vlurp https://github.com/whoever/cool-configs
# → Creates ./whoever/cool-configs

# Clone a GitHub Gist
vlurp https://gist.github.com/user/abc123def456
# → Creates ./user/abc123def456

# Show help
vlurp --help

# Filter files (default: .claude/** and CLAUDE.md)
vlurp cool-repo/has-agents --filter "*.ts" --filter "*.tsx"

# Download only specific directories
vlurp whoever/cool-configs --filter "lib/**" --filter "doc/**"

# Download only markdown files
vlurp user/repo --filter "*.md"
```

## Features

- 🚀 Fast - Downloads tarballs instead of cloning entire git history
- 📦 Lightweight - Minimal dependencies
- 🎨 Beautiful - Clean output with progress indicators
- 🔒 Secure - Only works with github.com and gist.github.com
- 🌈 Simple - Just pass a repo or URL and go!
- 🎯 Selective - Filter files with glob patterns (defaults to .claude/** and CLAUDE.md)

## Requirements

- Node.js >= 18.0.0

## Development

```sh
# Clone the repository
vlurp indexzero/vlurp

# Install dependencies
cd indexzero/vlurp
pnpm install

# Run tests
pnpm test

# Run locally
node bin/vlurp <user>/<repo>
```

