# VLURP.ATTEST.PLAN: Sigstore Attestation for Skill Packs

Port of [nono-attest](https://github.com/always-further/nono-attest) concepts to JavaScript using `sigstore-js`. No Rust CLI dependency. No runtime sandbox. Pure npm package attestation for the vlurp skill pack pipeline.

## Reference: What nono-attest Does

nono-attest is a GitHub Action that signs AI agent instruction files (SKILL.md, CLAUDE.md, etc.) using Sigstore keyless attestation. It produces **Sigstore v0.3 bundles** containing:

| Layer | Content |
|-------|---------|
| **DSSE Envelope** | `payloadType: "application/vnd.in-toto+json"`, payload is an in-toto v1 statement |
| **In-toto Statement** | `subject`: filename + SHA-256 digest; `predicateType`: attestation type URI; `predicate`: signer identity (OIDC issuer, repo, workflow ref) |
| **Verification Material** | Fulcio certificate chain (keyless) OR public key hint (keyed); Rekor transparency log inclusion proof |
| **Signature** | ECDSA P-256 over the DSSE Pre-Authentication Encoding (PAE) |

Verification confirms four things: Fulcio certificate chain validity, Rekor inclusion proof (timestamp within certificate window), ECDSA signature validity, and OIDC claim matching against a trust policy.

Two signing modes: **multi-subject** (single `.nono-trust.bundle` covering all files atomically) and **per-file** (`<file>.bundle` sidecars for independent verification).

## What vlurp Ports (and What It Doesn't)

### Ported

| nono-attest concept | vlurp equivalent |
|---------------------|------------------|
| `nono trust sign --keyless` | `vlurp attest` using `sigstore.attest()` |
| `nono trust verify --policy` | `vlurp verify --sigstore` using `sigstore.verify()` |
| `.nono-trust.bundle` (multi-subject) | `.vlurp.sigstore` (per-source bundles) |
| `<file>.bundle` (per-file) | Not needed -- vlurp's lineage model groups files by source |
| `trust-policy.json` (publisher definitions) | `.vlurp-trust.json` (same schema, adapted for vlurp sources) |
| GitHub Actions OIDC identity | `@sigstore/sign` `CIContextProvider` |
| Fulcio certificate OID matching | `sigstore.verify()` `certificateOIDs` option |

### Not ported

| nono-attest concept | Why not |
|---------------------|---------|
| Runtime sandbox (seccomp, Seatbelt) | vlurp is a package manager, not a runtime. File interception is out of scope. |
| TOCTOU protection | No runtime file access mediation. vlurp verifies at fetch time. |
| Pre-exec scan | vlurp's `verify` command is the equivalent -- user runs it explicitly. |
| nono CLI binary installation | Replaced entirely by `sigstore` npm package (pure JS). |
| Per-file bundles | vlurp's source-level lineage makes per-source bundles the natural unit. |

## sigstore-js API Mapping

```
npm: sigstore@4.1.0
  @sigstore/sign@4.1.0
  @sigstore/verify@3.1.0
  @sigstore/bundle@4.0.0
  @sigstore/core@3.1.0
  @sigstore/tuf@4.0.1
  @sigstore/protobuf-specs@0.5.0
```

### Signing (attest)

```js
import { attest } from 'sigstore';

// Build in-toto statement payload
const statement = {
  _type: 'https://in-toto.io/Statement/v1',
  subject: [
    { name: 'gstack/browse/SKILL.md', digest: { sha256: 'abc123...' } },
    { name: 'gstack/review/SKILL.md', digest: { sha256: 'def456...' } },
    // ... all files from lineage record
  ],
  predicateType: 'https://vlurp.dev/attestation/skill-pack/v1',
  predicate: {
    source: 'github:garrytan/gstack',
    ref: 'abc1234def5678...',
    fetched_at: '2026-03-17T10:00:00Z',
    vlurp_version: '2.0.0'
  }
};

const payload = Buffer.from(JSON.stringify(statement));

const bundle = await attest(payload, 'application/vnd.in-toto+json', {
  // Keyless (CI): uses Fulcio + OIDC token from environment
  // identityToken is auto-detected in GitHub Actions via CIContextProvider
  fulcioURL: 'https://fulcio.sigstore.dev',
  rekorURL: 'https://rekor.sigstore.dev',
  tlogUpload: true
});

// bundle is a SerializedBundle (JSON-serializable Sigstore v0.3 bundle)
await writeFile('.vlurp.sigstore', JSON.stringify(bundle, null, 2));
```

### Verification

```js
import { verify } from 'sigstore';

const bundle = JSON.parse(await readFile('.vlurp.sigstore', 'utf8'));

const signer = await verify(bundle, {
  // Fulcio certificate OID matching (maps to trust policy publishers)
  certificateIssuer: 'https://token.actions.githubusercontent.com',
  certificateOIDs: {
    '1.3.6.1.4.1.57264.1.8': 'https://github.com/garrytan/gstack',  // source repo
    '1.3.6.1.4.1.57264.1.9': 'refs/heads/main',                      // ref
    '1.3.6.1.4.1.57264.1.11': '.github/workflows/attest.yml'          // workflow
  }
});

// signer contains the verified identity claims
// Then: extract in-toto statement from DSSE envelope, compare subject digests
// against files on disk (reuse vlurp's existing hashFile / verifyFiles)
```

### CI Identity Detection

```js
import { CIContextProvider } from '@sigstore/sign';

// In GitHub Actions, this reads ACTIONS_ID_TOKEN_REQUEST_URL +
// ACTIONS_ID_TOKEN_REQUEST_TOKEN to get an OIDC token from GitHub's
// token endpoint. The token contains claims: repository, workflow,
// ref, sha, etc. Fulcio extracts these into X.509 certificate extensions.
const provider = new CIContextProvider('sigstore');
const token = await provider.getToken();
```

## Architecture

### Data Flow

```
UPSTREAM REPO (signing)                    CONSUMER (verification)
==========================                 ==========================

CI workflow runs:                          vlurp fetch garrytan/gstack
  vlurp attest --keyless                     |
    |                                        +--> download tarball
    +--> hash SKILL.md files                 +--> extract + filter
    +--> build in-toto statement             +--> hash files (lineage)
    +--> sigstore.attest()                   +--> write .vlurp.jsonl
    |     |                                  |
    |     +--> Fulcio (get cert)             |
    |     +--> sign DSSE envelope            |
    |     +--> Rekor (log signature)         |
    |                                        |
    +--> commit .vlurp.sigstore              |
                                             |
                                           If .vlurp.sigstore exists in repo:
                                             +--> download bundle
                                             +--> sigstore.verify(bundle)
                                             +--> match OIDs against trust policy
                                             +--> compare statement subjects
                                                  against fetched file hashes
                                             +--> record attestation status
                                                  in .vlurp.jsonl
```

### Two Attestation Models

**Model A: Upstream signs, consumer verifies** (recommended)

The skill pack author runs `vlurp attest` in their CI. The `.vlurp.sigstore` bundle is committed to the repo. When a consumer runs `vlurp fetch`, vlurp downloads the bundle alongside the content, verifies it against the consumer's trust policy, and records the attestation status in lineage.

This is the direct port of nono-attest. The identity in the Fulcio certificate is the upstream CI workflow. The consumer trusts specific publishers defined in `.vlurp-trust.json`.

**Model B: Consumer signs locally** (optional, for private repos / air-gapped)

The consumer runs `vlurp attest` in their own CI after fetching. The identity is the consumer's CI workflow. This creates a local chain of trust: "I fetched this content from this source at this ref and signed it with my CI identity." Useful when the upstream repo doesn't use Sigstore, but the consumer wants attestation for their own audit trail.

Model A and Model B can be composed: verify upstream attestation, then re-sign with local identity.

## Trust Policy

### `.vlurp-trust.json`

```json
{
  "version": 1,
  "publishers": [
    {
      "name": "gstack CI",
      "source": "github:garrytan/gstack",
      "issuer": "https://token.actions.githubusercontent.com",
      "repository": "garrytan/gstack",
      "workflow": ".github/workflows/attest.yml",
      "ref_pattern": "refs/heads/main"
    },
    {
      "name": "obra skills",
      "source": "github:obra/claude-skills",
      "issuer": "https://token.actions.githubusercontent.com",
      "repository": "obra/claude-skills"
    }
  ],
  "blocklist": {
    "digests": []
  },
  "enforcement": "warn"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `version` | yes | Schema version (always `1`) |
| `publishers[].name` | yes | Human-readable publisher label |
| `publishers[].source` | yes | vlurp source string to match (e.g. `github:garrytan/gstack`) |
| `publishers[].issuer` | yes | Expected OIDC issuer in Fulcio certificate |
| `publishers[].repository` | no | Expected source repository OID (`1.3.6.1.4.1.57264.1.8`) |
| `publishers[].workflow` | no | Expected workflow URI OID (`1.3.6.1.4.1.57264.1.11`) |
| `publishers[].ref_pattern` | no | Glob pattern for allowed refs OID (`1.3.6.1.4.1.57264.1.9`) |
| `blocklist.digests` | no | SHA-256 digests to reject regardless of valid signature |
| `enforcement` | yes | `"warn"` (log and continue) or `"deny"` (fail fetch) |

### Enforcement Semantics

| enforcement | No bundle | Bundle present, invalid | Bundle present, valid | Blocklisted digest |
|-------------|-----------|------------------------|-----------------------|-------------------|
| `warn` | fetch proceeds, log warning | fetch proceeds, log warning | fetch proceeds, log success | fetch **fails** |
| `deny` | fetch **fails** | fetch **fails** | fetch proceeds | fetch **fails** |

Blocklist always wins. A valid signature on a blocklisted file is still rejected.

## New Commands

### `vlurp attest [--keyless] [--key <path>] [--source <source>]`

Sign fetched content using Sigstore.

```sh
# Keyless (CI): uses OIDC token from environment
vlurp attest --keyless

# Sign specific source
vlurp attest --keyless --source garrytan/gstack

# Sign all sources in .vlurpfile
vlurp attest --keyless
```

**Behavior:**

1. Read `.vlurp.jsonl` to get lineage records with file hashes
2. For each source (or specified source):
   a. Build in-toto v1 statement with all files as subjects
   b. Set `predicateType` to `https://vlurp.dev/attestation/skill-pack/v1`
   c. Set predicate to `{ source, ref, fetched_at, vlurp_version }`
   d. Call `sigstore.attest(payload, 'application/vnd.in-toto+json', options)`
   e. Write bundle to `.vlurp.sigstore` (or `<source-dir>/.vlurp.sigstore`)
3. Commit bundle files if `--commit` is set

### `vlurp verify --sigstore [--trust-policy <path>]`

Enhanced verify that checks both file integrity AND Sigstore attestation.

```sh
# Verify files + sigstore bundles against default trust policy
vlurp verify --sigstore .claude/skills

# Verify with explicit trust policy
vlurp verify --sigstore --trust-policy .vlurp-trust.json .claude/skills

# Existing behavior (file integrity only, unchanged)
vlurp verify .claude/skills
```

**Behavior:**

1. Run existing `verifyFiles()` (SHA-256 integrity check against lineage)
2. If `--sigstore` flag:
   a. Load trust policy from `.vlurp-trust.json` (or `--trust-policy` path)
   b. For each source with a `.vlurp.sigstore` bundle:
      - Load and parse the Sigstore bundle
      - Find matching publisher in trust policy by `source` field
      - Call `sigstore.verify(bundle, { certificateIssuer, certificateOIDs })` with publisher's OID expectations
      - Extract in-toto statement from verified DSSE envelope
      - Compare statement subjects against files on disk (SHA-256)
      - Check file digests against blocklist
   c. Report per-source attestation status

### `vlurp trust init`

Generate a starter `.vlurp-trust.json` from existing `.vlurpfile` sources.

```sh
vlurp trust init
# Creates .vlurp-trust.json with one publisher entry per source,
# pre-filled with GitHub Actions OIDC issuer and source repository.
# User fills in workflow and ref_pattern.
```

## New Modules

### `src/attest.js` -- Core attestation logic

```
Exports:
  buildInTotoStatement({ source, ref, fetchedAt, files })
    --> { _type, subject, predicateType, predicate }

  signStatement(statement, options)
    --> SerializedBundle  (calls sigstore.attest)

  verifyBundle(bundle, publisher)
    --> { valid, signer, subjects }  (calls sigstore.verify, extracts statement)

  matchSubjects(subjects, diskFiles)
    --> [{ file, status: 'ok' | 'mismatch' | 'missing' | 'extra' }]
```

### `src/trust-policy.js` -- Trust policy operations

```
Exports:
  loadTrustPolicy(policyPath)
    --> parsed and validated policy object

  findPublisher(policy, source)
    --> publisher entry or null

  publisherToVerifyOptions(publisher)
    --> { certificateIssuer, certificateOIDs }  (sigstore VerifyOptions)

  checkBlocklist(policy, digests)
    --> [{ digest, blocked: true/false }]

  initTrustPolicy(sources)
    --> starter policy JSON string
```

### `src/commands/attest.js` -- CLI command (Ink component)

### `src/commands/trust.js` -- Trust policy management CLI

## Modified Modules

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
    "bundle": ".vlurp.sigstore",
    "signer": {
      "issuer": "https://token.actions.githubusercontent.com",
      "repository": "garrytan/gstack",
      "workflow": ".github/workflows/attest.yml",
      "ref": "refs/heads/main"
    },
    "verified_at": "2026-03-17T10:01:00Z"
  }
}
```

When no Sigstore bundle is present, `attestation` is `null`.

### `src/commands/verify.js`

Add `--sigstore` flag path that calls `verifyBundle()` and `matchSubjects()` after the existing `verifyFiles()` check.

### `src/commands/fetch.js`

After fetching, check if a `.vlurp.sigstore` exists in the upstream repo. If it does and a trust policy is configured, verify it inline during fetch. Record attestation status in lineage.

### `src/index.js`

Export new public API surface:

```js
export { buildInTotoStatement, signStatement, verifyBundle, matchSubjects } from './attest.js';
export { loadTrustPolicy, findPublisher, checkBlocklist } from './trust-policy.js';
```

## In-toto Statement Schema

```json
{
  "_type": "https://in-toto.io/Statement/v1",
  "subject": [
    {
      "name": "gstack/browse/SKILL.md",
      "digest": { "sha256": "e3b0c44298fc1c14..." }
    },
    {
      "name": "gstack/browse/bin/find-browse",
      "digest": { "sha256": "7f83b1657ff1fc53..." }
    }
  ],
  "predicateType": "https://vlurp.dev/attestation/skill-pack/v1",
  "predicate": {
    "source": "github:garrytan/gstack",
    "ref": "abc1234def5678901234567890abcdef12345678",
    "ref_type": "commit",
    "fetched_at": "2026-03-17T10:00:00Z",
    "vlurp_version": "2.0.0",
    "filters": ["**/*.md", "bin/**"],
    "preset": "skills"
  }
}
```

This follows the [in-toto v1 statement spec](https://github.com/in-toto/attestation/blob/main/spec/v1/statement.md). The `subject` array lists every file in the lineage record with its SHA-256 digest. The predicate carries vlurp-specific provenance metadata.

## Fulcio Certificate OID Reference

These X.509 extension OIDs are set by Fulcio from the OIDC token claims. Used for publisher matching in trust policy verification.

| OID | Field | Example |
|-----|-------|---------|
| `1.3.6.1.4.1.57264.1.1` | OIDC issuer | `https://token.actions.githubusercontent.com` |
| `1.3.6.1.4.1.57264.1.8` | Source repository | `https://github.com/garrytan/gstack` |
| `1.3.6.1.4.1.57264.1.9` | Repository ref | `refs/heads/main` |
| `1.3.6.1.4.1.57264.1.11` | Build config (workflow URI) | `https://github.com/garrytan/gstack/.github/workflows/attest.yml@refs/heads/main` |

Note: `sigstore.verify()` accepts `certificateIssuer` as a top-level option (maps to OID `1.3.6.1.4.1.57264.1.1`) and `certificateOIDs` as a `Record<string, string>` for the rest.

## GitHub Action for Upstream Signing

Skill pack authors add this to their CI (replaces the nono-attest action with pure vlurp + sigstore-js):

```yaml
name: Attest skill packs
on:
  push:
    branches: [main]
    paths: ['**/SKILL.md', 'skills/**']

permissions:
  id-token: write   # Required for Sigstore keyless signing
  contents: write   # Required to commit .vlurp.sigstore bundles

jobs:
  attest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npx vlurp attest --keyless --commit
```

That's it. `npx vlurp attest --keyless --commit` hashes all SKILL.md files and their supporting files, builds in-toto statements, signs them via Sigstore, and commits the `.vlurp.sigstore` bundles.

## Implementation Phases

### Phase 1: Core Attestation (`src/attest.js`)

- `buildInTotoStatement()` -- construct in-toto v1 statement from lineage record
- `signStatement()` -- call `sigstore.attest()` with the statement payload
- `verifyBundle()` -- call `sigstore.verify()` and extract the in-toto statement
- `matchSubjects()` -- compare in-toto subjects against disk files
- Test suite: unit tests with mock bundles, integration test with real Sigstore staging instance

Dependencies: `sigstore@^4.1.0`

### Phase 2: Trust Policy (`src/trust-policy.js`)

- `loadTrustPolicy()` -- read and validate `.vlurp-trust.json`
- `findPublisher()` -- match a vlurp source to a trust policy publisher
- `publisherToVerifyOptions()` -- convert publisher to sigstore VerifyOptions
- `checkBlocklist()` -- reject blocklisted digests
- `initTrustPolicy()` -- generate starter policy from `.vlurpfile` sources
- Test suite: policy matching, enforcement semantics, blocklist precedence

No new dependencies.

### Phase 3: Commands

- `vlurp attest` -- Ink component, calls `signStatement()` per source
- `vlurp verify --sigstore` -- enhanced verify with Sigstore bundle checking
- `vlurp trust init` -- generates `.vlurp-trust.json`
- Integration with `vlurp fetch`: auto-verify upstream `.vlurp.sigstore` if trust policy exists
- Integration with `vlurp upgrade`: carry attestation status through upgrade flow

### Phase 4: GitHub Action

- `.github/actions/vlurp-attest/action.yml` -- composite action wrapping `npx vlurp attest`
- Documentation for skill pack authors
- Example workflows

## Dependency Budget

| Package | Size | Why |
|---------|------|-----|
| `sigstore@^4.1.0` | ~2.5MB installed | Signing, verification, TUF root, bundle types |

Single dependency. The `sigstore` package bundles `@sigstore/sign`, `@sigstore/verify`, `@sigstore/bundle`, `@sigstore/core`, `@sigstore/tuf`, and `@sigstore/protobuf-specs`. This is the official npm Sigstore client maintained by the Sigstore project.

## Testing Strategy

### Unit Tests

- `test/attest.test.js` -- Statement building, subject matching (no network)
- `test/trust-policy.test.js` -- Policy parsing, publisher matching, enforcement logic

### Integration Tests

- Sign with Sigstore staging (`fulcio.sigstore.dev` / `rekor.sigstore.dev`)
- Requires `ACTIONS_ID_TOKEN_REQUEST_URL` in CI or manual OIDC token
- Skip in local dev, run in CI with `id-token: write` permission

### Mock Tests

- Mock `sigstore.attest()` / `sigstore.verify()` for command-level tests
- Pre-built test bundles for verify path testing

## Open Questions

1. **Bundle storage granularity**: One `.vlurp.sigstore` per source directory, or a single `.vlurp.sigstore` at the vlurpfile level containing multiple bundles? Per-source is simpler and matches lineage semantics. Single file means one verification for the entire skill set.

2. **Upstream bundle discovery**: How does `vlurp fetch` know where to look for the upstream `.vlurp.sigstore`? Convention: look for `.vlurp.sigstore` at the repo root. Or: the upstream repo declares it in a `vlurp.json` manifest. Simplest: just check if the file exists in the fetched tarball.

3. **Key-based signing**: The plan focuses on keyless (CI OIDC). Should `vlurp attest --key <path>` support local key-based signing for air-gapped environments? `sigstore-js` supports this but the verification path is different (no Fulcio certificate, just a public key).

4. **Predicate type URI**: `https://vlurp.dev/attestation/skill-pack/v1` is a placeholder. Should this be a real, resolvable URL with a JSON schema? The in-toto spec recommends it but doesn't require it.

5. **Rekor log permanence**: Signing uploads to the public Rekor transparency log. This means all vlurp attestations are publicly discoverable. Is this acceptable for private skill packs? If not, `tlogUpload: false` skips Rekor but loses the timestamp proof.
