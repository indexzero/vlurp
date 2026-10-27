---
'vlurp': patch
---

A copy destination ending in `/` is now always a directory. vlurp creates it if it is missing and places sources beneath it by basename, so `vlurp 'pkg:github/user/repo#guide.md' ./references/docs/` no longer writes a file named `docs` when the directory does not exist yet. The trailing `/` is kept when a `.vlurpfile` resolves its destinations, and a `DEST/` that names an existing file is rejected.
