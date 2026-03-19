# Attestation Plans: Head-to-Head

Side-by-side comparison of VLURP.ATTEST.PLAN.md (sigstore-js) vs NONO.ATTEST.PLAN.md (nono-direct) to decide how vlurp should implement Sigstore attestation for skill packs.

## Comparison Table

| Dimension | sigstore-js (VLURP.ATTEST.PLAN) | nono-direct (NONO.ATTEST.PLAN) |
|-----------|--------------------------------|-------------------------------|
| **New npm deps** | `sigstore@4.1.0` (~2.5MB, 6 transitive pkgs) | None |
| **External binary** | None | `nono` (~15MB, user installs separately) |
| **New vlurp code** | ~400-500 LOC (attest.js, trust-policy.js, 2 commands) | ~200-250 LOC (nono.js bridge, trust-policy.js, 2 commands) |
| **Signing capability** | Yes -- `vlurp attest --keyless` | No -- user runs `nono trust sign` directly |
| **Verification** | In-process `sigstore.verify()` | Shell out to `nono trust verify` |
| **Runtime enforcement** | None. Advisory only. | Kernel-enforced via `nono run` (seccomp/Seatbelt) |
| **Trust policy format** | Custom `.vlurp-trust.json` | nono-native `trust-policy.json` |
| **Bundle format** | Custom `.vlurp.sigstore` | nono-native `.nono-trust.bundle` |
| **Predicate type** | `https://vlurp.dev/attestation/skill-pack/v1` (island) | `https://nono.sh/attestation/instruction-file/v1` (ecosystem) |
| **Upstream signing action** | Must build `vlurp-attest` action (doesn't exist) | `nono-attest` (already on GitHub Marketplace) |
| **Platform support** | Everywhere Node runs (incl. Windows) | macOS + Linux only (no Windows, no musl) |
| **Error handling** | Structured JS exceptions | Exit codes + stderr parsing |
| **Maturity of crypto dep** | `sigstore` is stable, used by npm itself | nono is alpha ("not recommended for production") |
| **Consumer-side signing** | Yes (Model B: sign with your own CI identity) | Possible but vlurp doesn't orchestrate it |
| **Works without attestation tool** | Graceful -- sigstore bundled in vlurp, always available | Graceful -- falls back to SHA-256 only when nono absent |

## The Three Questions That Matter

### 1. Does vlurp need to sign, or just verify?

**sigstore-js** gives vlurp both. `vlurp attest --keyless` lets upstream authors AND consumers sign. This is important for Model B (consumer re-signs for their own audit trail) and means skill pack authors only need vlurp, not two tools.

**nono** makes vlurp verification-only. Signing requires the author to set up nono-attest. This is fine for the "upstream signs, consumer verifies" flow, but means vlurp can't offer consumer-side signing without wrapping `nono trust sign` (adding the binary dependency anyway).

**Verdict**: If consumer-side signing (Model B) matters, sigstore-js is better. If upstream-signs-consumer-verifies is sufficient, nono works.

### 2. Does runtime enforcement change the security model?

**sigstore-js** verification is a checkpoint. After `vlurp verify --sigstore` passes, nothing prevents file modification before the agent reads it. An attacker with write access to the skill directory can swap files between verification and agent launch.

**nono** closes this gap with kernel enforcement. `nono run -- claude` re-verifies files at every `open()` syscall (Linux) or blocks unverified reads entirely (macOS). This is a fundamentally different security property -- not just "was this file signed?" but "is this file STILL the signed version at the moment the agent reads it?"

**Verdict**: If the threat model includes post-verification tampering (shared machines, untrusted environments), only nono helps. If the threat model is "verify the supply chain at fetch time," both are equivalent.

### 3. How much ecosystem coupling is acceptable?

**sigstore-js** makes vlurp self-contained but creates an island. `.vlurp-trust.json`, `.vlurp.sigstore`, and `https://vlurp.dev/attestation/skill-pack/v1` are vlurp-specific. No other tool understands them. If the broader agent security ecosystem converges on nono's formats, vlurp would need to bridge or migrate.

**nono** makes vlurp a citizen of nono's ecosystem. The same `trust-policy.json` works for `vlurp verify --attest` and `nono run`. The same `.nono-trust.bundle` is understood by nono-py, nono-ts, and any future tool that reads nono's predicate type. But vlurp is coupled to nono's schema evolution -- if nono changes `trust-policy.json` v2, vlurp must follow.

**Verdict**: nono's ecosystem is early but has momentum (from the creator of Sigstore, already has Rust/Python/TypeScript SDKs). Betting on it is reasonable. Being coupled to alpha software is a real risk.

## Risks

### sigstore-js risks

- **You build the wrong thing.** vlurp invents a predicate type, trust policy format, and bundle naming convention. If the ecosystem standardizes on nono's conventions, you've built an island that needs a bridge.
- **Signing is advisory.** You invest in attestation infrastructure that sophisticated attackers bypass by modifying files after verification. The security story has an asterisk.
- **Upstream adoption friction.** Skill pack authors must install vlurp (or use a vlurp-specific action) to sign. nono-attest is already shipping.

### nono risks

- **Alpha instability.** nono is v0.18.0 with an explicit "not for production" warning. CLI flags, trust-policy schema, or bundle format could change. vlurp's nono bridge could break on nono upgrades.
- **Adoption barrier.** Most vlurp users won't install nono. Attestation becomes a power-user feature that the majority never enables. The feature investment has a small audience.
- **Shell-out fragility.** `nono trust verify` output format is not contractual. Parsing stderr for status details is brittle. No `--json` flag exists yet.
- **No Windows.** vlurp runs on Windows (Node). nono doesn't. Attestation is platform-gated.

## Recommendation

**Start with nono. Keep the door open for sigstore-js.**

### Why nono first

1. **Less code, faster to ship.** The nono bridge is ~200 LOC vs ~500 LOC for the sigstore-js plan. Phase 1-2 are minimal investment.

2. **Signing is already solved.** `nono-attest` exists on GitHub Marketplace. No competing action to build. Upstream authors can start signing today.

3. **One trust policy, two enforcement points.** The same `trust-policy.json` that `vlurp verify --attest` uses also works with `nono run -- claude`. Users who want the full security story get it without maintaining two policy files.

4. **Runtime enforcement is the differentiator.** The pitch: "vlurp manages your skill packs, nono secures them. Together they give you an unbroken chain from upstream CI to kernel-enforced agent execution." sigstore-js can't make this pitch.

5. **The escape hatch exists.** Sigstore v0.3 bundles are a standard format. If nono dies or changes incompatibly, sigstore-js verification can read the same `.nono-trust.bundle` files. The lineage schema and trust-policy concepts translate directly. No lock-in.

### The hedge

Write `src/trust-policy.js` to be generic. Don't leak nono-specific details (binary paths, CLI flags) beyond `src/nono.js`. If a `src/sigstore.js` backend is added later implementing the same `{ verify(bundle, policy) }` interface, the rest of vlurp doesn't change.

### Build order

1. `src/nono.js` -- detect + shell-out bridge (Phase 1, ~80 LOC)
2. `src/trust-policy.js` -- read/generate `trust-policy.json` (Phase 2, ~100 LOC)
3. `vlurp trust init` + `vlurp trust show` (Phase 3a, ~100 LOC)
4. `vlurp verify --attest` (Phase 3b, ~80 LOC)
5. Bundle extraction in fetch pipeline (Phase 3c, ~30 LOC)

Total: ~390 LOC of new vlurp code, zero new npm dependencies, attestation verification that composes with nono's runtime enforcement.
