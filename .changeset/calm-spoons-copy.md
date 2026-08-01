---
'vlurp': minor
---

Add `vlurp SOURCE... DEST` copying with `pkg:github` PURL sources and glob selection inside `#subpath`. Copies now support familiar basename semantics, multiple remote sources, embedded refs, destination-relative lineage, vlurpfile pin/upgrade integration, and traversal-safe preflight planning. Repeatable `--glob` and case-insensitive `--iglob` patterns filter files beneath cp sources, and existing presets compose with the new interface. Repository shorthand, presets, and `--filter` remain fully supported.
