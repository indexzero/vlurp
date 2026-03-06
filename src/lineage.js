import {createHash} from 'node:crypto';
import {
  readFile, writeFile, readdir
} from 'node:fs/promises';
import {join, relative} from 'node:path';

/**
 * Compute SHA-256 hash of a file's contents.
 */
export async function hashFile(filePath) {
  const content = await readFile(filePath);
  const hash = createHash('sha256').update(content).digest('hex');
  const size = content.length;
  return {sha256: hash, size};
}

/**
 * Recursively hash all files under a directory.
 * Returns an object mapping relative paths to {sha256, size}.
 */
export async function hashDirectory(dirPath) {
  const files = {};

  async function walk(dir) {
    const entries = await readdir(dir, {withFileTypes: true});
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(fullPath);
      } else {
        const relPath = relative(dirPath, fullPath);
        // eslint-disable-next-line no-await-in-loop
        const {sha256, size} = await hashFile(fullPath);
        files[relPath] = {sha256, size};
      }
    }
  }

  await walk(dirPath);
  return files;
}

/**
 * Create a lineage record for a fetch operation.
 */
export function createLineageRecord({source, ref, refType, filters, preset, asName, files}) {
  return {
    source: `github:${source}`,
    ref: ref || null,
    ref_type: refType || (ref ? 'commit' : null), // eslint-disable-line camelcase
    fetched_at: new Date().toISOString(), // eslint-disable-line camelcase
    filters: filters || [],
    preset: preset || null,
    as: asName || null,
    files
  };
}

/**
 * Append a lineage record to a .vlurp.jsonl file.
 */
export async function appendLineage(jsonlPath, record) {
  let existing = '';
  try {
    existing = await readFile(jsonlPath, 'utf8');
  } catch {
    // File doesn't exist yet
  }

  // Replace existing record for the same source+as combo, or append
  const lines = existing.split('\n').filter(l => l.trim());
  const key = recordKey(record);
  const filtered = lines.filter(l => {
    try {
      const parsed = JSON.parse(l);
      return recordKey(parsed) !== key;
    } catch {
      return true;
    }
  });

  filtered.push(JSON.stringify(record));
  await writeFile(jsonlPath, filtered.join('\n') + '\n');
}

/**
 * Read all lineage records from a .vlurp.jsonl file.
 */
export async function readLineage(jsonlPath) {
  let content;
  try {
    content = await readFile(jsonlPath, 'utf8');
  } catch {
    return [];
  }

  return content
    .split('\n')
    .filter(l => l.trim())
    .map(l => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Verify files on disk against lineage records.
 * Returns an array of {file, status, expected, actual} objects.
 */
export async function verifyFiles(basePath, records) {
  const results = [];

  // Build a map of all tracked files from lineage records
  const tracked = new Map();
  for (const record of records) {
    // Determine the directory prefix for files in this record.
    // If --as was used, files are under {as}/
    // Otherwise, files are under {user}/{repo}/ derived from source
    let prefix = '';
    if (record.as) {
      prefix = record.as;
    } else {
      // Source is "github:user/repo" — extract "user/repo"
      const sourceId = record.source.replace(/^github:/, '');
      prefix = sourceId;
    }

    for (const [filePath, meta] of Object.entries(record.files || {})) {
      const fullRelPath = join(prefix, filePath);
      tracked.set(fullRelPath, {
        ...meta,
        source: record.source,
        ref: record.ref
      });
    }
  }

  // Check each tracked file
  for (const [relPath, expected] of tracked) {
    const fullPath = join(basePath, relPath);
    try {
      // eslint-disable-next-line no-await-in-loop
      const {sha256} = await hashFile(fullPath);
      if (sha256 === expected.sha256) {
        results.push({
          file: relPath, status: 'ok', expected: expected.sha256, actual: sha256
        });
      } else {
        results.push({
          file: relPath, status: 'modified', expected: expected.sha256, actual: sha256
        });
      }
    } catch {
      results.push({
        file: relPath, status: 'missing', expected: expected.sha256, actual: null
      });
    }
  }

  // Find untracked files on disk
  try {
    const diskFiles = await hashDirectory(basePath);
    for (const relPath of Object.keys(diskFiles)) {
      // Skip the .vlurp.jsonl file itself
      if (relPath === '.vlurp.jsonl' || relPath === '.vlurp.sigstore') {
        continue;
      }

      if (!tracked.has(relPath)) {
        results.push({
          file: relPath, status: 'untracked', expected: null, actual: diskFiles[relPath].sha256
        });
      }
    }
  } catch {
    // Directory might not exist
  }

  return results.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Unique key for a lineage record (source + as name).
 */
function recordKey(record) {
  return `${record.source}::${record.as || ''}`;
}
