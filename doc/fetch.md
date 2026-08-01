# Copying Remote Files

vlurp treats a GitHub repository as a remote filesystem and uses the familiar command shape:

```sh
vlurp SOURCE... DEST
```

The sources are Package URLs (PURLs). The destination is a local file or directory.

## Source grammar

```text
pkg:github/<owner>/<repository>@<ref>#<subpath>
```

The ref and subpath are optional:

```sh
# Repository root at its default branch
vlurp 'pkg:github/obra/superpowers' ./superpowers

# Exact directory at a tag, branch, or commit
vlurp 'pkg:github/anthropics/skills@b7c8d9e#skills/pdf' ./skills/

# Exact file
vlurp 'pkg:github/user/repo@v1.0.0#docs/guide.md' ./docs/
```

When `@ref` is omitted, GitHub's default branch is resolved at execution time. A commit SHA is the reproducible choice.

## PURL patterns

A canonical PURL identifies one exact repository subpath. vlurp extends the `#subpath` with glob selection:

```sh
vlurp 'pkg:github/mattpocock/skills#skills/in-progress/writing-*' ./skills/
```

This produces:

```text
./skills/writing-beats/
./skills/writing-fragments/
./skills/writing-shape/
```

Only the subpath can contain glob syntax. The provider, owner, repository, and ref must be exact. Quote patterned PURLs so your shell does not interpret `*`, `?`, or brackets.

Every exact `pkg:github` PURL is a valid vlurp source. Once unescaped glob syntax appears in its subpath, the operand is a vlurp source pattern rather than a canonical PURL identity.

## Copy semantics

vlurp follows recursive `cp` operand semantics:

- A source copied into an existing directory is placed beneath it by basename.
- A single source copied to a missing destination creates that destination.
- Multiple sources require an existing destination directory.
- Two selected sources with the same basename are rejected before anything is written.
- Existing matching files are overwritten; unrelated files remain in place.
- Without `--force`, vlurp asks before copying over an existing destination path.

Examples:

```sh
# Rename one exact file
vlurp 'pkg:github/user/repo#docs/guide.md' ./README.md

# Copy two directories into an existing directory
vlurp \
  'pkg:github/anthropics/skills@main#skills/pdf' \
  'pkg:github/anthropics/skills@main#skills/slides' \
  ./skills/
```

## Safety

Subpaths must be relative and cannot contain empty, `.` or `..` segments or encoded path separators. Archive paths that escape the repository are discarded, and symbolic and hard links are not extracted. Copy plans are validated for destination collisions before writing.

## Preview and overwrite

```sh
vlurp 'pkg:github/user/repo#skills/*' ./skills/ --dry-run
vlurp 'pkg:github/user/repo#skills/*' ./skills/ --force
```

`--dry-run` resolves the remote selector and prints the concrete copy plan without writing files or lineage.

## Lineage

Every completed copy writes `.vlurp.jsonl` beside the copied set. Its file keys are relative to the lineage file, so `vlurp verify <directory>` can check the exact destination layout without reconstructing it from the repository name.

## Legacy syntax

The v2 fetch grammar remains available during migration:

```sh
vlurp user/repo -d ./skills --filter 'skills/*' --ref abc1234
```

New manifests and commands should use PURL source operands. The PURL carries repository identity, ref, and selection in one value, eliminating `-d`, `--filter`, `--as`, and `--strip-prefix` path gymnastics.
