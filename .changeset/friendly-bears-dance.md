---
"vlurp": minor
---

Improve vlurp user experience based on v1.0.0 feedback:

- **Terminology**: Replace all "clone" references with "vlurp" to better reflect that we download tarballs
- **Enhanced default filters**: Now includes `*.md` files (excluding common repo files), `/agents` and `/commands` directories. Refactored to use `glob` for cleaner, more reliable pattern matching
- **Re-vlurping protection**: Warns when overwriting existing directories, shows file count, can bypass with `--force` flag
- **Tree display**: Automatically shows directory structure after vlurping with total file count using ASCII tree. Fixed to show hidden directories like `.claude`