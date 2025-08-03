# Contributing to vlurp

Thank you for your interest in contributing to vlurp! This document provides guidelines and instructions for contributors.

## Development

```sh
# Clone the repository
git clone git@github.com:indexzero/vlurp.git

# Install dependencies
cd indexzero/vlurp
pnpm install

# Run tests
pnpm test

# Run locally
node bin/vlurp <user>/<repo>
```

## Development Workflow

### Running Tests

Tests are run using Node.js's built-in test runner:

```sh
pnpm test
```

### Linting

The project uses XO for linting:

```sh
# Check for linting errors
pnpm lint

# Auto-fix linting errors
pnpm lint:fix
```

## Pull Request Process

1. Fork the repository and create your branch from `main`
2. Make your changes and ensure tests pass
3. Run the linter and fix any issues
4. Create a changeset for your changes (see below)
5. Submit a pull request

## Using Changesets

This project uses [changesets](https://github.com/changesets/changesets) to manage versions and changelogs.

### Creating a Changeset

When you make changes that should be included in the changelog:

```sh
pnpm changeset
```

This will prompt you to:
1. Select which packages are affected (for this single-package repo, just select `vlurp`)
2. Choose the type of change (major, minor, or patch)
3. Write a description of the change for the changelog

The changeset will be created in the `.changeset` directory. Commit this file along with your changes.

### Version Updates

Version updates are handled automatically by the GitHub Actions workflow. When changesets are merged to `main`, a PR will be automatically created to:
- Update the version in `package.json`
- Update the CHANGELOG.md
- Remove the changeset files

### Publishing

Publishing to npm happens automatically when the version PR is merged. This requires the `NPM_TOKEN` secret to be configured in the repository settings.

## CI/CD

The project uses GitHub Actions for continuous integration:

### Test Workflow

Runs on:
- All pull requests to `main`
- All pushes to `main`

The workflow:
- Tests against Node.js 20.x and 22.x
- Runs the linter
- Runs the test suite

### Release Workflow

Runs on pushes to `main` and handles:
- Creating version update PRs via changesets
- Publishing to npm when version PRs are merged

## Code Style

- The project uses tabs for indentation
- Follow the existing code style (enforced by XO)
- No spaces inside object curly braces
- Use trailing commas in multi-line arrays and objects
- Keep imports organized and use default imports where appropriate

## Testing

- Write tests for new features
- Ensure all tests pass before submitting a PR
- Tests are located in the `test/` directory
- Use Node.js's built-in test runner and assertion library

## Commit Messages

- Use clear, descriptive commit messages
- Start with a verb in the present tense (e.g., "Add", "Fix", "Update")
- Keep the first line under 72 characters
- Reference issues when applicable

## Questions?

If you have questions about contributing, feel free to open an issue for discussion.
