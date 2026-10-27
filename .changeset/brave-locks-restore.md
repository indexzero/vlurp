---
'vlurp': minor
---

Add restore from lineage and make local files a first-class operand. `vlurp ./path/.vlurp.jsonl` fetches the files a lineage records and writes them only when every file's bytes match the recorded sha256. It writes only the recorded paths, writes nothing if any file fails the check, skips files that already match, refuses locally modified files unless `--force`, and never rewrites `.vlurp.jsonl`. This lets a repository commit only lineage and fetch the content on demand. `vlurp ./path/.vlurpfile` runs a manifest, and vlurp picks restore or manifest from the file's contents; `vlurp batch <file>` remains an alias with the same routing. Repository shorthand no longer misreads local paths or JSON lines as `owner/repo`.
