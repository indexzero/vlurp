# vlurp

## 2.0.0

### Major Changes

- f4a3277: An ingress layer for AI agent content — fetch, pin, prove, scan, diff.

  ### Breaking changes

  - **Default filters expanded.** v1 matched `.claude/**` and `CLAUDE.md`. v2 defaults also include `*.md`, `**/*.md` (excluding README, LICENSE, CONTRIBUTING, CHANGELOG, CODE_OF_CONDUCT), `agents/**`, and `commands/**`. If you relied on the old defaults, pass `--preset minimal` or explicit `--filter` flags.
  - **Lineage records are now written on every fetch.** A `.vlurp.jsonl` file is created at your target directory root containing SHA-256 hashes of every file fetched. This file should be committed to git — it is the machine-readable receipt of what was actually fetched.
  - **Unpinned fetches now warn.** Fetching without `--ref` prints a warning that upstream content is mutable. This is intentional — mutable upstream is how supply chain attacks happen.

  ### New in v2

  **Pin and prove**

  ```sh
  # Pin to a commit. Immutable content. Reproducible fetches.
  vlurp dcramer/dex -d ./skills --filter "plugins/dex/skills/dex/**" --as dex --ref 939f6cb

  # Flatten deep repo paths into something you can find
  vlurp obra/the-elements-of-style -d ./skills --as writing-style

  # Verify nothing has changed since you reviewed it
  vlurp verify ./skills

  # Pin every unpinned entry in your .vlurpfile to current upstream HEAD
  vlurp pin
  ```

  **Detect upstream changes before they become instructions**

  ```sh
  # Which of your pinned refs are behind upstream?
  vlurp outdated .vlurpfile

  # What exactly changed? Content diff, not commit log.
  vlurp diff dcramer/dex -d ./skills
  ```

  **Know what a skill tells your agent to do**

  ```sh
  # Surface area analysis — tool references, external commands, injection patterns
  vlurp scan ./skills
  ```

  Output tells you what matters: which tools the content references, which shell commands it instructs your agent to run, and whether it contains known injection or escalation patterns. A report, not a verdict — because the human makes the trust decision.

  **Catalog your skills**

  ```sh
  # Generate catalog.json from SKILL.md frontmatter
  vlurp catalog ./skills
  ```

  **Presets for common repo structures**

  ```sh
  vlurp user/repo --preset skills     # skills/**, SKILL.md, **/*.md
  vlurp user/repo --preset agents     # agents/**, commands/**, **/*.md
  vlurp user/repo --preset claude     # .claude/**, CLAUDE.md
  vlurp user/repo --preset docs       # **/*.md (excluding boilerplate)
  vlurp user/repo --auto              # auto-detect repo structure via GitHub API
  ```

  **The `.vlurpfile` is a manifest you can read**

  ```sh
  # Skills for AI agent context — reviewed and pinned
  vlurp dcramer/dex -d ./skills --filter "plugins/dex/skills/dex/**" --as dex --ref 939f6cb
  vlurp obra/superpowers -d ./skills --preset skills --ref abc1234
  ```

  One fetch command per line. Human-readable. Greppable. Run any line by itself. The `.vlurpfile` is intent. The `.vlurp.jsonl` alongside it is reality. Both get committed. Both get reviewed.

## 1.2.0

### Minor changes

- 091dbfd: Add `**/*.md` to the default filter

## 1.1.0

### Minor Changes

- 50c3c6e: Improve vlurp user experience based on v1.0.0 feedback:

  - **Terminology**: Replace all "clone" references with "vlurp" to better reflect that we download tarballs
  - **Enhanced default filters**: Now includes `*.md` files (excluding common repo files), `/agents` and `/commands` directories. Refactored to use `glob` for cleaner, more reliable pattern matching
  - **Re-vlurping protection**: Warns when overwriting existing directories, shows file count, can bypass with `--force` flag
  - **Tree display**: Automatically shows directory structure after vlurping with total file count using ASCII tree. Fixed to show hidden directories like `.claude`

## 1.0.0

### Major Changes

- 58a1e06: Initial release (1.0.0)
