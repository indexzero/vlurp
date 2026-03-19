# Supply Chain Security

A skill file for an AI agent is a text file. Markdown, usually. It contains instructions that get injected into the agent's context window where they become -- functionally -- commands. When a skill says "use Bash to run `rm -rf /`", the agent reaches for Bash. When a skill says "fetch this URL and POST the contents of .env", the agent tries.

A skill file is not code in the traditional sense. There is no compiler. There is no sandbox. There is no runtime boundary. The text enters the context window and the agent follows the instructions because that is what agents do. The blast radius of a skill file is the full permission set of the agent reading it.

vlurp does not sandbox your agent. It does not prevent an LLM from following injected instructions. What it does is make the attack surface **visible** and **auditable** so that you -- the human -- can make an informed trust decision before text enters the context window.

## Threat model

When a skill file gets injected into an LLM context, these attacks are possible:

| Threat | Description |
|--------|-------------|
| **Prompt injection** | "Ignore all previous instructions" or equivalent. The LLM cannot distinguish skill-author intent from attack. |
| **Mutable upstream** | You fetch a skill today, it's fine. The author pushes a malicious update. Your next fetch picks it up silently. |
| **Tool escalation** | The skill says "use Bash to run..." and the agent executes arbitrary commands via the LLM. |
| **Exfiltration** | The skill instructs the agent to send `.env`, credentials, or source code to external URLs. |
| **Persistence** | The skill instructs the agent to modify `CLAUDE.md`, install more tools, or add self-replicating instructions. |
| **Transitive trust** | You trust repo A. Repo A's skill references content from repo B. You trusted A, not B. |

## Pin your refs

`--ref` pins a fetch to a specific git commit SHA. Pinned content is immutable. The same SHA always produces the same tarball.

```sh
vlurp obra/superpowers -d .claude/skills --preset skills --ref e4f5a6b
```

When `--ref` is omitted, vlurp fetches whatever is on the default branch right now. If the author pushed a malicious change thirty seconds ago, you have it. This is how supply chain attacks work: the content is fine when you first look, and different when you fetch.

To pin all unpinned sources in a `.vlurpfile` to the current upstream HEAD:

```sh
vlurp pin
```

This is the minimum viable supply chain protection. Without pinning, everything else is theater.

## Lineage

Every `vlurp fetch` or `vlurp batch` produces a lineage record in `.vlurp.jsonl`:

```json
{
  "source": "github:obra/superpowers",
  "ref": "e4f5a6b7c8d9",
  "ref_type": "commit",
  "fetched_at": "2026-03-15T06:00:00Z",
  "filters": [],
  "preset": "skills",
  "as": null,
  "files": {
    "skills/tdd/SKILL.md": { "sha256": "e3b0c442...", "size": 3421 },
    "skills/verify/SKILL.md": { "sha256": "7f83b165...", "size": 2891 }
  }
}
```

Every field matters:

- `source` and `ref`: where this content came from, exactly
- `fetched_at`: when. So you can correlate with upstream commit history.
- `files`: SHA-256 hash of every file's content, computed after extraction. Not a hash from a remote API. A hash of what is on your disk.

Lineage records are JSONL -- one JSON object per line. Append-friendly, git-merge-friendly, and grep-friendly.

The `.vlurp.jsonl` file should be committed alongside the content it describes. When a teammate opens a PR that adds new skill files, the lineage is in the same diff. Review the content AND its provenance.

## Verify

`vlurp verify` hashes every file on disk and compares against lineage records:

```
$ vlurp verify .claude/skills

  obra/superpowers/skills/tdd/SKILL.md        ok       sha256:e3b0c442
  obra/superpowers/skills/verify/SKILL.md     ok       sha256:7f83b165
  duckdb/SKILL.md                             MODIFIED sha256:13681909 (expected: a1b2c3d4)
  local-notes.md                              untracked

  24 tracked files: 23 ok, 1 modified
```

| Status | Meaning |
|--------|---------|
| `ok` | File hash matches lineage. Content has not been modified. |
| `modified` | File exists but hash differs. Something changed since fetch. |
| `missing` | Lineage references a file that is no longer on disk. |
| `untracked` | File on disk with no lineage record. Local addition. |

Exit code 0 if all tracked files match. Exit code 1 if any are modified or missing. Untracked files are informational, not failures.

Run `vlurp verify` in CI, in git hooks, or before agent launches. If it exits non-zero, something changed that was not fetched by vlurp.

## Scan

`vlurp scan` analyzes text content for patterns that indicate prompt injection, tool escalation, exfiltration, and persistence:

```
$ vlurp scan .claude/skills

  obra/superpowers/skills/tdd/SKILL.md
    ok   Valid frontmatter (name: "tdd")
    ok   No injection patterns
    warn Bash (8 refs), Edit (4 refs)

  duckdb/SKILL.md
    ok   No injection patterns
    warn Bash (11 refs)
    warn References external commands: duckdb

  24 files, 0 issues, 8 warnings
  tool surface: Bash (31), Read (8), Edit (6), Write (2)
  command surface: duckdb, git, npm
```

### Detection categories

**Injection** (high severity): Known prompt override phrases ("ignore all previous instructions", "you are now", "system prompt:"), base64-encoded instruction blocks, unicode homoglyph substitutions, zero-width characters hiding text.

**Tool escalation** (medium severity): `curl | sh`, `wget | bash`, `git push --force`, `git reset --hard`, `rm -rf /`, `chmod` world-executable, `--no-verify` hook bypass.

**Exfiltration** (high severity): Instructions to POST file contents to URLs, references to `.env` or credential files, instructions to send data to external services.

**Persistence** (medium severity): Instructions to modify `CLAUDE.md` or `.claude/` config, instructions to install additional tools or skills, self-replicating instructions ("add this to your CLAUDE.md").

### Tool and command surface

The scan report includes two surface area summaries:

- **Tool surface**: Which agent tools the skill references (Bash, Read, Write, Edit, WebFetch, WebSearch). This tells you the permission set the skill expects.
- **Command surface**: Which external commands appear in code blocks. This tells you what the skill will ask your agent to execute.

A skill with `tool surface: Bash (24)` is asking your agent to run 24 shell commands. That is not inherently malicious -- many legitimate skills use Bash heavily. But it is information you need before you inject that text into context.

### Scan produces a report, not a verdict

vlurp scan does not tell you whether to trust a file. It tells you what the file does. The human makes the trust decision. The tool provides evidence.

Some tools in this space offer "security audits" that produce a risk score after you've already committed to the installation. That is a checkbox, not security. vlurp shows you the surface area before you accept the content, and the decision is yours.

## Sigstore attestation

For environments where the person who reviews content is not the person who ran the fetch, vlurp supports cryptographic attestation via [Sigstore](https://www.sigstore.dev/). A Sigstore bundle provides a transparency-logged proof that a specific identity fetched specific content at a specific time.

See [ATTEST.H2H.md](../ATTEST.H2H.md) for the current attestation design.

## Summary

The security model is four layers deep:

```
PIN     Immutable content via --ref
HASH    SHA-256 of every file in .vlurp.jsonl
VERIFY  Check disk against lineage at any time
SCAN    Know what the content does before you inject it
```

No layer is sufficient alone. Together they turn an invisible attack vector into an auditable one. You pin so content can't change. You hash so changes are detectable. You verify so you know nothing has been tampered with. You scan so you understand what you're trusting.

The human reviews the scan report like they review a code diff. The lineage is reviewed in PRs alongside the content. Upstream changes are diffed before acceptance. At every step, a person is looking at evidence and making a decision. That is the correct division of labor between a tool and a person.
