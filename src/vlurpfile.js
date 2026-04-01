import { resolve } from 'node:path';
import { PRESETS } from './presets.js';

/**
 * Parses a .vlurpfile and returns an array of vlurp commands.
 *
 * Format:
 *   # Comments start with #
 *   vlurp user/repo -d ./vlurp
 *   vlurp user/repo -d ./vlurp --filter "pattern"
 *   vlurp user/repo --preset claude
 */
export function parseVlurpfile(content) {
  const lines = content.split('\n');
  const entries = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Parse the vlurp command
    const entry = parseVlurpLine(trimmed);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Update the --ref value for a specific source in vlurpfile content.
 * Preserves comments, blank lines, and argument ordering.
 * If the entry has no --ref, appends one.
 * Returns the updated content string.
 */
export function updateRef(content, source, newRef) {
  const lines = content.split('\n');
  const result = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Preserve comments and blank lines as-is
    if (!trimmed || trimmed.startsWith('#')) {
      result.push(line);
      continue;
    }

    // Check if this line matches the target source
    const lineSource = extractSource(trimmed);
    if (lineSource !== source) {
      result.push(line);
      continue;
    }

    // This line matches -- update or insert --ref
    result.push(replaceRef(line, newRef));
  }

  return result.join('\n');
}

/**
 * Update --ref values for multiple sources at once.
 * `updates` is a Map or object of { source: newRef }.
 * Returns the updated content string.
 */
export function updateRefs(content, updates) {
  const map = updates instanceof Map ? updates : new Map(Object.entries(updates));
  const lines = content.split('\n');
  const result = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      result.push(line);
      continue;
    }

    const lineSource = extractSource(trimmed);
    if (lineSource && map.has(lineSource)) {
      result.push(replaceRef(line, map.get(lineSource)));
    } else {
      result.push(line);
    }
  }

  return result.join('\n');
}

/**
 * Extract the source (e.g. "user/repo") from a vlurpfile line.
 */
function extractSource(line) {
  const command = line.startsWith('vlurp ') ? line.slice(6).trim() : line;
  const args = parseArgs(command);
  return args.length > 0 ? args[0] : null;
}

/**
 * Replace or insert --ref in a single vlurpfile line.
 */
function replaceRef(line, newRef) {
  // Match existing --ref and its value (handles quoted and unquoted)
  const refPattern = /--ref\s+(?:"[^"]*"|\S+)/;
  if (refPattern.test(line)) {
    return line.replace(refPattern, `--ref ${newRef}`);
  }

  // No existing --ref -- append before trailing newline/whitespace
  const trimmed = line.trimEnd();
  return `${trimmed} --ref ${newRef}`;
}

/**
 * Parses a single vlurp command line.
 */
function parseVlurpLine(line) {
  // Remove 'vlurp' prefix if present
  const command = line.startsWith('vlurp ') ? line.slice(6).trim() : line;

  // Simple argument parser
  const args = parseArgs(command);

  if (args.length === 0) {
    return null;
  }

  const source = args[0];
  const entry = {
    source,
    rootDir: null,
    filters: [],
    preset: null,
    ref: null,
    as: null,
    force: false
  };

  // Parse options
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-d' && args[i + 1]) {
      entry.rootDir = args[++i];
    } else if (arg === '--filter' && args[i + 1]) {
      entry.filters.push(args[++i]);
    } else if (arg === '--preset' && args[i + 1]) {
      entry.preset = args[++i];
      if (PRESETS[entry.preset]) {
        entry.filters = [...PRESETS[entry.preset].filters];
      }
    } else if (arg === '--ref' && args[i + 1]) {
      entry.ref = args[++i];
    } else if (arg === '--as' && args[i + 1]) {
      entry.as = args[++i];
    } else if (arg === '-f' || arg === '--force') {
      entry.force = true;
    }
  }

  // Calculate target path
  if (entry.as && entry.rootDir) {
    entry.targetPath = resolve(entry.rootDir, entry.as);
  } else if (entry.as) {
    entry.targetPath = resolve(entry.as);
  } else if (entry.rootDir) {
    const parts = source.split('/');
    if (parts.length >= 2) {
      const [user, repo] = parts;
      entry.targetPath = resolve(entry.rootDir, user, repo);
    }
  }

  return entry;
}

/**
 * Simple argument parser that handles quoted strings.
 */
function parseArgs(string_) {
  const args = [];
  const regex = /(?:[^\s"]+|"[^"]*")+/g;
  let match;

  while ((match = regex.exec(string_)) !== null) {
    // Remove surrounding quotes
    args.push(match[0].replaceAll(/^"|"$/g, ''));
  }

  return args;
}
