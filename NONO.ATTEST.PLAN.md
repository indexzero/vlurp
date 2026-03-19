# NONO.ATTEST.PLAN: Use nono-attest Directly

Use [nono](https://github.com/always-further/nono) as the attestation engine instead of reimplementing with sigstore-js. vlurp orchestrates which files to sign/verify and records results in lineage. nono owns the crypto, the bundle format, the trust policy schema, and -- uniquely -- kernel-enforced runtime verification.

## Why nono Instead of sigstore-js

The sigstore-js plan (VLURP.ATTEST.PLAN.md) rebuilds the attestation stack in JavaScript: in-toto statement construction, DSSE signing, Fulcio/Rekor interaction, trust policy matching. This works, but it reimplements what nono already does and misses the feature that makes nono interesting: **runtime enforcement**.

| Concern | sigstore-js | nono |
|---------|-------------|------|
| Signing | `sigstore.attest()` -- JS library call | `nono trust sign --keyless` -- CLI |
| Verification | `sigstore.verify()` -- JS library call | `nono trust verify --policy` -- CLI |
| In-toto statement | vlurp builds it | nono builds it |
| Trust policy | vlurp-specific `.vlurp-trust.json` | nono-native `trust-policy.json` |
| Bundle format | vlurp-specific `.vlurp.sigstore` | nono-native `.nono-trust.bundle` / `<file>.bundle` |
| Runtime enforcement | None. Signing is advisory. | Kernel-enforced. seccomp (Linux), Seatbelt (macOS). Agent cannot read unverified files. |
| Predicate type | `https://vlurp.dev/attestation/skill-pack/v1` (custom) | `https://nono.sh/attestation/instruction-file/v1` (nono standard) |
| Dependency | `sigstore@4.1.0` (~2.5MB npm) | `nono` binary (~15MB, platform-specific) |
| Upstream adoption | Skill pack author must use vlurp to sign | Skill pack author uses nono-attest action (already exists, already on GitHub Marketplace) |

The decisive advantage: with nono, `vlurp fetch` + `nono run -- claude` gives you an unbroken chain from CI signing to kernel-enforced runtime verification. With sigstore-js, signing is advisory -- nothing stops a modified file from being read after verification.

## Architecture

### The Two-Tool Model

vlurp and nono have complementary roles:

```
vlurp                                    nono
============================             ============================
Package manager for skill packs          Security infrastructure

- Fetch files from GitHub                - Sign files (Sigstore keyless)
- Filter, extract, rename                - Verify bundles (trust policy)
- Track lineage (.vlurp.jsonl)           - Runtime sandbox (kernel-enforced)
- Catalog skills (catalog.json)          - Pre-exec scan (verify before read)
- Upgrade with structured diffs          - TOCTOU protection (re-verify fd)
- Content scanning (prompt injection)    - Blocklist enforcement
```

vlurp tells nono WHAT to sign/verify. nono does the crypto and enforcement. Neither tool replaces the other.

### Data Flow

```
UPSTREAM REPO                        CONSUMER MACHINE
=================================    =================================

Skill pack author's CI:              User runs:
                                       vlurp fetch garrytan/gstack
  nono-attest action                     |
    |                                    +--> download tarball
    +--> nono trust sign --keyless       +--> extract + filter
    |      --all                         +--> hash files (lineage)
    |                                    +--> write .vlurp.jsonl
    +--> commits:                        |
         SKILL.md                        +--> also fetches *.bundle files
         bin/helper.sh                   |    from tarball if present
         .nono-trust.bundle              |
                                         +--> vlurp verify --attest
                                         |      |
                                         |      +--> nono trust verify
                                         |             --policy trust-policy.json
                                         |             --all
                                         |      |
                                         |      +--> record attestation in
                                         |           .vlurp.jsonl
                                         |
                                         +--> User launches agent:
                                              nono run --profile claude-code
                                                -- claude
                                              |
                                              +--> pre-exec scan verifies
                                              |    all SKILL.md bundles
                                              +--> kernel sandbox blocks
                                                   reads of unverified files
```

### What vlurp Does vs What nono Does

**vlurp's job (orchestration):**

1. Know which files belong to which source (lineage)
2. Download bundles alongside content during fetch
3. Invoke `nono trust verify` with the right files and policy
4. Record attestation results in `.vlurp.jsonl`
5. Present attestation status in `vlurp verify` output
6. Generate/manage `trust-policy.json` from vlurpfile sources

**nono's job (crypto + enforcement):**

1. Construct in-toto v1 statements with file subjects + SHA-256 digests
2. Sign via Sigstore (Fulcio certificate, Rekor log, DSSE envelope)
3. Produce `.nono-trust.bundle` / `<file>.bundle` artifacts
4. Verify bundles: certificate chain, Rekor proof, signature, OID matching
5. Runtime: block reads of unverified instruction files via kernel mechanisms

## nono Binary Management

### Installation

vlurp does NOT install nono automatically. nono is an independent tool the user installs themselves:

```bash
# macOS / Linux
brew install nono

# Or from GitHub releases
curl -fsSL https://github.com/always-further/nono/releases/latest/download/nono-v0.18.0-aarch64-apple-darwin.tar.gz | tar xz
sudo mv nono /usr/local/bin/

# Verify
nono --version
```

vlurp checks for nono's presence and degrades gracefully:

```
$ vlurp verify --attest .claude/skills

  nono not found. Install it for Sigstore attestation verification:
    brew install nono
    https://github.com/always-further/nono

  Falling back to SHA-256 integrity verification only.
```

### Why Not Auto-Install

1. nono is a security tool. Users should make a conscious decision to install it.
2. Platform-specific binaries are fragile to auto-install (glibc versions, code signing).
3. nono has its own update mechanism and release cadence.
4. `brew install nono` is one command. No need to over-engineer this.

### Detection

```js
// src/nono.js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function isNonoInstalled() {
  try {
    const { stdout } = await exec('nono', ['--version']);
    return { installed: true, version: stdout.trim() };
  } catch {
    return { installed: false, version: null };
  }
}
```

## nono CLI Interface

### Signing

```bash
# Sign all instruction files matching trust policy patterns
nono trust sign --keyless --all

# Sign specific files as multi-subject bundle
nono trust sign --keyless SKILL.md bin/helper.sh config/settings.json
# -> produces .nono-trust.bundle

# Sign specific files as per-file bundles
nono trust sign --keyless SKILL.md
# -> produces SKILL.md.bundle
```

### Verification

```bash
# Verify all instruction files against trust policy
nono trust verify --policy trust-policy.json --all

# Verify specific bundle
nono trust verify --policy trust-policy.json SKILL.md
```

### Relevant Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Signing/verification succeeded |
| 1 | Verification failed (invalid signature, policy mismatch, etc.) |
| non-zero | Various error conditions |

### Bundle Output

nono produces standard Sigstore v0.3 bundles:

| Mode | File | Content |
|------|------|---------|
| Multi-subject (default) | `.nono-trust.bundle` | Single DSSE envelope covering all specified files |
| Per-file | `<file>.bundle` | One DSSE envelope per file |

Both contain: DSSE envelope with in-toto v1 statement, Fulcio certificate chain, Rekor transparency log inclusion proof, ECDSA P-256 signature.

## Trust Policy

vlurp uses nono's native `trust-policy.json` format. No vlurp-specific schema.

### `trust-policy.json`

```json
{
  "version": 1,
  "instruction_patterns": ["SKILLS*", "SKILL*", "CLAUDE*", "AGENT*", ".claude/**/*.md"],
  "publishers": [
    {
      "name": "gstack CI",
      "issuer": "https://token.actions.githubusercontent.com",
      "repository": "garrytan/gstack",
      "workflow": ".github/workflows/sign-instruction-files.yml",
      "ref_pattern": "refs/heads/main"
    },
    {
      "name": "obra skills",
      "issuer": "https://token.actions.githubusercontent.com",
      "repository": "obra/claude-skills"
    }
  ],
  "blocklist": { "digests": [] },
  "enforcement": "deny"
}
```

### nono Fields vs vlurp Source Mapping

| trust-policy.json field | Maps to | Notes |
|-------------------------|---------|-------|
| `publishers[].repository` | vlurpfile source (e.g. `garrytan/gstack`) | nono uses GitHub `owner/repo`, matches vlurp's source format |
| `publishers[].issuer` | Always `https://token.actions.githubusercontent.com` for GitHub Actions | |
| `publishers[].workflow` | The upstream repo's signing workflow path | User must know this |
| `publishers[].ref_pattern` | Allowed branch/tag refs | Glob pattern matching |
| `instruction_patterns` | Glob patterns for auto-discovery with `--all` | Separate from vlurp's lineage-based file tracking |
| `enforcement` | `"warn"` or `"deny"` | Controls whether verification failure blocks |

### `vlurp trust init`

vlurp generates a starter `trust-policy.json` from the `.vlurpfile`:

```
$ vlurp trust init

  Generated trust-policy.json with 2 publisher entries:

    garrytan/gstack      (fill in workflow path)
    obra/claude-skills   (fill in workflow path)

  Edit trust-policy.json to add workflow paths and ref_patterns.
```

Generated file:

```json
{
  "version": 1,
  "instruction_patterns": ["SKILL*", "CLAUDE*", "AGENT*", ".claude/**/*.md"],
  "publishers": [
    {
      "name": "garrytan/gstack",
      "issuer": "https://token.actions.githubusercontent.com",
      "repository": "garrytan/gstack",
      "workflow": "",
      "ref_pattern": "refs/heads/main"
    },
    {
      "name": "obra/claude-skills",
      "issuer": "https://token.actions.githubusercontent.com",
      "repository": "obra/claude-skills",
      "workflow": "",
      "ref_pattern": "refs/heads/main"
    }
  ],
  "blocklist": { "digests": [] },
  "enforcement": "warn"
}
```

The user fills in `workflow` paths. Enforcement defaults to `"warn"` so that first-time setup doesn't break fetches.

## New Commands

### `vlurp verify --attest [--trust-policy <path>] <target>`

Enhanced verify that runs SHA-256 integrity check AND nono bundle verification.

```sh
# Full verification: integrity + Sigstore attestation
vlurp verify --attest .claude/skills

# With explicit trust policy
vlurp verify --attest --trust-policy trust-policy.json .claude/skills

# Existing behavior (unchanged, integrity only)
vlurp verify .claude/skills
```

**Behavior:**

1. Run existing `verifyFiles()` (SHA-256 integrity against lineage) -- always
2. If `--attest`:
   a. Check if nono is installed. If not, warn and skip attestation check.
   b. Find `.nono-trust.bundle` or `*.bundle` files alongside fetched content
   c. For each bundle found:
      - Shell out to `nono trust verify --policy <policy> <files>`
      - Parse exit code (0 = valid, non-zero = invalid)
      - Capture stdout/stderr for status details
   d. Record per-source attestation status
   e. Report in verify output

**Output (nono installed, bundles present):**

```
Verify: .claude/skills

  garrytan/gstack
    SKILL.md                                        ok  (sha256: e3b0c442...)
    browse/SKILL.md                                 ok  (sha256: 7f83b165...)
    browse/bin/find-browse                          ok  (sha256: a1b2c3d4...)

    attestation: verified
      signer: garrytan/gstack (.github/workflows/attest.yml)
      signed:  2026-03-16T10:00:00Z (refs/heads/main)
      bundle:  .nono-trust.bundle

  obra/claude-skills
    patterns/SKILL.md                               ok  (sha256: 9f86d081...)

    attestation: no bundle found

All 4 tracked files verified (1 source attested, 1 source unattested)
```

**Output (nono not installed):**

```
Verify: .claude/skills

  garrytan/gstack
    SKILL.md                                        ok  (sha256: e3b0c442...)
    browse/SKILL.md                                 ok  (sha256: 7f83b165...)

    attestation: skipped (nono not installed)

All 3 tracked files verified (attestation checks skipped -- install nono for Sigstore verification)
```

### `vlurp trust init`

Generate `trust-policy.json` from `.vlurpfile` sources (described above).

```sh
vlurp trust init                    # generates trust-policy.json
vlurp trust init --enforcement deny # set enforcement to deny
```

### `vlurp trust show`

Display current trust policy and match against fetched sources.

```sh
$ vlurp trust show

  trust-policy.json (enforcement: warn)

  Publishers:
    garrytan/gstack
      issuer:    https://token.actions.githubusercontent.com
      workflow:  .github/workflows/attest.yml
      ref:       refs/heads/main
      status:    matched (source in .vlurpfile)

    obra/claude-skills
      issuer:    https://token.actions.githubusercontent.com
      workflow:  (not configured)
      ref:       refs/heads/main
      status:    matched (source in .vlurpfile)

  Blocklist: 0 digests

  Unmatched vlurpfile sources (no publisher entry):
    anthropics/prompt-eng
```

## New Modules

### `src/nono.js` -- nono CLI bridge

Thin wrapper for shelling out to the nono binary.

```
Exports:
  isNonoInstalled()
    --> { installed: boolean, version: string | null }

  nonoSign({ files, keyless, workingDir })
    --> { ok: boolean, bundles: string[], output: string }
    Calls: nono trust sign [--keyless] [--all | <files...>]

  nonoVerify({ policy, files, workingDir })
    --> { ok: boolean, output: string }
    Calls: nono trust verify [--policy <path>] [--all | <files...>]
```

### `src/trust-policy.js` -- Trust policy generation + reading

```
Exports:
  loadTrustPolicy(policyPath)
    --> parsed trust-policy.json object (nono's schema)

  initTrustPolicy(sources, options)
    --> trust-policy.json content string

  findPublisherForSource(policy, source)
    --> publisher entry or null

  unmatchedSources(policy, sources)
    --> source strings with no publisher entry
```

### `src/commands/trust.js` -- Trust subcommands (Ink component)

Handles `vlurp trust init` and `vlurp trust show`.

## Modified Modules

### `src/commands/verify.js`

Add `--attest` flag. When set, after the existing SHA-256 check, call `nonoVerify()` and display attestation results.

### `src/commands/fetch.js`

When fetching a tarball, check if `*.bundle` or `.nono-trust.bundle` files are present. If so, include them in the extracted files (currently vlurp may filter these out depending on glob patterns). Record their presence in the lineage record.

### `src/lineage.js`

Add `attestation` field to lineage records:

```json
{
  "source": "github:garrytan/gstack",
  "ref": "abc1234",
  "fetched_at": "2026-03-17T10:00:00Z",
  "files": { ... },
  "attestation": {
    "status": "verified",
    "bundle": ".nono-trust.bundle",
    "verified_at": "2026-03-17T10:01:00Z",
    "nono_version": "0.18.0"
  }
}
```

| status | Meaning |
|--------|---------|
| `"verified"` | nono verified the bundle successfully |
| `"failed"` | nono verification failed (invalid sig, policy mismatch) |
| `"no-bundle"` | No `.bundle` file found in upstream repo |
| `"skipped"` | nono not installed, verification not attempted |
| `null` | Attestation not checked (legacy fetch, `--attest` not used) |

### `src/cli.js`

Add `--attest` and `--trust-policy` flags. Add `trust` command routing.

### `src/index.js`

Export nono bridge and trust policy functions.

## Bundle Discovery During Fetch

When `vlurp fetch garrytan/gstack` downloads a tarball, vlurp already extracts files matching glob filters. The question is how to find nono bundles in the upstream repo.

### Strategy: Include bundles in tarball extraction

GitHub tarballs include all committed files. If the upstream repo committed `.nono-trust.bundle` or `SKILL.md.bundle`, they're in the tarball. vlurp's extraction pipeline already sees them.

**Change needed**: Ensure `.nono-trust.bundle` and `*.bundle` files are not excluded by filter globs. When the `--preset skills` filter is active (which matches `**/SKILL.md` and supporting files), extend it to also match `**/*.bundle` and `**/.nono-trust.bundle`.

```js
// In preset definition or filter logic
const BUNDLE_GLOBS = ['**/*.bundle', '**/.nono-trust.bundle'];
```

After extraction, vlurp records which bundles were found in the lineage record. If `--attest` is used (or a trust policy exists), vlurp runs `nono trust verify` immediately.

## Upstream Signing (Skill Pack Authors)

Skill pack authors use the nono-attest GitHub Action directly. No vlurp involvement in signing.

### Minimal Setup

```yaml
name: Sign instruction files
on:
  push:
    branches: [main]
    paths: ['**/SKILL.md', 'scripts/**']

permissions:
  id-token: write
  contents: write

jobs:
  sign:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: always-further/nono-attest@v0.0.2
```

That's it. nono-attest installs the nono binary, signs all instruction files matching its default patterns, verifies as a smoke test, and commits the `.bundle` files.

### With Explicit File List

```yaml
- uses: always-further/nono-attest@v0.0.2
  with:
    files: "SKILL.md browse/SKILL.md review/SKILL.md bin/find-browse"
```

### Per-File Bundles

```yaml
- uses: always-further/nono-attest@v0.0.2
  with:
    per-file: "true"
```

### vlurp's Role

vlurp does NOT provide a competing GitHub Action for signing. The signing action IS nono-attest. vlurp's documentation tells skill pack authors: "Use nono-attest to sign your instruction files. Consumers who use vlurp will automatically verify the bundles."

## Runtime Enforcement (The Bonus)

This is the feature sigstore-js cannot provide. When the user runs their agent through nono:

```bash
nono run --profile claude-code -- claude
```

nono's pre-exec scan:

1. Locates all files matching `instruction_patterns` in the trust policy
2. Verifies `trust-policy.json`'s own bundle signature
3. For each instruction file:
   - Finds `.bundle` sidecar
   - Validates Fulcio certificate chain
   - Confirms Rekor timestamp within certificate lifespan
   - Verifies ECDSA signature over DSSE PAE
   - Matches OIDC claims against trust policy publishers
   - Checks SHA-256 digest against blocklist
   - Computes file digest and compares to in-toto subject
4. If any file fails with `enforcement: "deny"` -- sandbox refuses to start
5. On Linux: seccomp-notify intercepts `openat2` syscalls, re-verifies on every file open (TOCTOU protection)
6. On macOS: Seatbelt rules deny reads of instruction files unless pre-verified

vlurp cannot do any of this. It doesn't need to. vlurp's job is to get the files there with integrity tracking. nono's job is to make sure the agent can only read verified files.

### The Combined Workflow

```bash
# 1. Fetch skill packs (vlurp)
vlurp batch

# 2. Verify attestation (vlurp shells out to nono)
vlurp verify --attest .claude/skills

# 3. Run agent with kernel-enforced file verification (nono)
nono run --profile claude-code -- claude
```

Steps 1-2 are vlurp. Step 3 is nono. The trust-policy.json is shared between them.

## Implementation Phases

### Phase 1: nono Bridge (`src/nono.js`)

- `isNonoInstalled()` -- detect nono binary, get version
- `nonoSign()` -- shell out to `nono trust sign`
- `nonoVerify()` -- shell out to `nono trust verify`, parse exit code
- Test suite: mock `execFile` for unit tests, real nono binary for integration tests (CI only)

No new npm dependencies. Just `node:child_process`.

### Phase 2: Trust Policy (`src/trust-policy.js`)

- `loadTrustPolicy()` -- read and validate `trust-policy.json` (nono's schema)
- `initTrustPolicy()` -- generate from `.vlurpfile` sources
- `findPublisherForSource()` -- match vlurp source to trust policy publisher
- `unmatchedSources()` -- find vlurpfile sources with no publisher entry
- Test suite: policy generation, source matching

No new npm dependencies.

### Phase 3: Commands

- `vlurp verify --attest` -- enhanced verify with nono attestation checking
- `vlurp trust init` -- generates `trust-policy.json`
- `vlurp trust show` -- displays trust policy status
- Bundle extraction during fetch (ensure `*.bundle` files aren't filtered out)
- Lineage `attestation` field recording
- CLI flag additions (`--attest`, `--trust-policy`)

### Phase 4: Documentation

- README section on attestation with nono
- Skill pack author guide (how to add nono-attest to your CI)
- Consumer guide (how to verify with vlurp + nono)
- trust-policy.json authoring guide

## Dependency Budget

No new npm dependencies. vlurp shells out to `nono` which the user installs independently.

| Component | How it's acquired |
|-----------|-------------------|
| nono binary | `brew install nono` or manual download from GitHub releases |
| trust-policy.json | `vlurp trust init` generates it, user edits |
| `.nono-trust.bundle` | Committed by upstream repo's nono-attest CI action |

## Tradeoffs vs sigstore-js Plan

### Advantages of nono-direct

1. **Runtime enforcement.** The only way to get kernel-enforced file verification. sigstore-js gives advisory verification that nothing enforces after the check.

2. **No new npm dependencies.** Zero added to vlurp's dependency tree. The nono binary is installed and managed independently.

3. **Upstream ecosystem compatibility.** Skill pack authors using nono-attest (already on GitHub Marketplace) produce bundles that vlurp automatically consumes. No need for a vlurp-specific signing action.

4. **Trust policy is shared.** The same `trust-policy.json` works for `vlurp verify --attest` and `nono run --profile claude-code`. One policy, two enforcement points.

5. **No crypto in vlurp.** vlurp never touches private keys, certificates, or signing operations. The security-critical code stays in nono's audited Rust implementation.

6. **nono's predicateType is the ecosystem standard.** `https://nono.sh/attestation/instruction-file/v1` is what other tools (nono run, nono-py, nono-ts) understand. A vlurp-specific predicate type would be an island.

### Disadvantages of nono-direct

1. **External binary dependency.** Users must install nono separately. Not everyone will. The attestation features are opt-in, not default.

2. **Platform-specific binary.** nono ships tarballs for linux-x86_64, darwin-x86_64, darwin-aarch64. No Windows. No musl. No 32-bit.

3. **Shell-out architecture.** Error handling is exit codes + stderr parsing. Less structured than a library call. nono's output format could change between versions.

4. **Alpha software.** nono is at v0.18.0 with an explicit "not recommended for production" warning. API surface may change. Bundle format may evolve.

5. **Two tools to learn.** Users need to understand both vlurp and nono. The sigstore-js plan keeps everything in one tool.

6. **No signing from vlurp.** The sigstore-js plan lets vlurp itself sign (for consumer-side attestation). The nono plan requires users to run `nono trust sign` directly. vlurp is verification-only.

### When to Choose Which

| Scenario | Recommendation |
|----------|---------------|
| Skill pack author wants to sign their files in CI | nono-attest (either plan) |
| Consumer wants verification at fetch time | Either plan works |
| Consumer wants kernel-enforced runtime protection | nono-direct (only option) |
| Consumer wants zero external dependencies | sigstore-js plan |
| Consumer is on Windows | sigstore-js plan (nono has no Windows support) |
| Ecosystem standardization matters | nono-direct (shared predicate type + trust policy) |
| vlurp wants to be self-contained | sigstore-js plan |

## Open Questions

1. **nono output parsing.** Does `nono trust verify` produce structured (JSON) output, or just human-readable text? If human-readable only, we rely on exit codes and hope the format is stable. Filing an issue for `--json` output would help.

2. **Bundle discovery conventions.** When vlurp fetches a tarball, should it look for `.nono-trust.bundle` at the repo root, or in each skill directory, or both? Need to match what nono-attest produces.

3. **Minimum nono version.** What's the minimum nono version vlurp should require? The `trust sign` / `trust verify` subcommands need to be stable. Pin to a minimum version and check on detection.

4. **Graceful degradation scope.** When nono is not installed, vlurp falls back to SHA-256 integrity only. Should vlurp warn on every fetch, or only when `--attest` is explicitly passed? Constant warnings would annoy users who don't care about attestation.

5. **Consumer-side signing.** The sigstore-js plan supports "consumer signs locally" (Model B). The nono plan could support this too (`nono trust sign --keyless` in the consumer's CI), but vlurp wouldn't orchestrate it. Is that OK, or does vlurp need a `vlurp attest` command that wraps `nono trust sign`?

6. **Can both plans coexist?** It's possible to implement nono-direct for verification (Phase 1-3) now, and add sigstore-js signing later for environments without nono. The trust policy and bundle format would need to be nono-compatible to avoid divergence.
