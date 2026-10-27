import { resolve } from 'node:path';
import process from 'node:process';
import { resolveDestination } from './copy-plan.js';
import { PRESETS } from './presets.js';
import { parseSourceOperand, replaceSourceRef } from './source-operand.js';

/**
 * Parse legacy and cp-style commands from a .vlurpfile. Relative DEST, -d, and
 * --as paths resolve from baseDir; commands pass the .vlurpfile's directory so
 * a .vlurpfile writes the same files from any working directory.
 */
export function parseVlurpfile(content, { baseDir = process.cwd() } = {}) {
  const entries = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const entry = parseVlurpLine(trimmed, { baseDir });
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

export function updateRef(content, source, newRef) {
  return updateRefs(content, new Map([[source, newRef]]));
}

/**
 * Update refs without reserializing command lines. PURL refs are embedded in
 * each source operand; legacy entries continue to use --ref.
 */
export function updateRefs(content, updates) {
  const map = updates instanceof Map ? updates : new Map(Object.entries(updates));
  return content
    .split('\n')
    .map(line => updateLineRefs(line, map))
    .join('\n');
}

export function parseVlurpLine(line, { baseDir = process.cwd() } = {}) {
  const command = line.startsWith('vlurp ') ? line.slice(6).trim() : line;
  const args = parseArgs(command);
  if (args.length === 0) {
    return null;
  }

  if (args[0].startsWith('pkg:')) {
    return parseCopyEntry(args, baseDir);
  }

  return parseLegacyEntry(args, baseDir);
}

function parseCopyEntry(args, baseDir) {
  const sources = [];
  let index = 0;
  while (args[index]?.startsWith('pkg:')) {
    parseSourceOperand(args[index]);
    sources.push(args[index++]);
  }

  const destination = args[index++];
  if (!destination || destination.startsWith('-')) {
    throw new Error('A cp-style vlurpfile entry requires SOURCE... DEST');
  }

  const entry = {
    mode: 'copy',
    source: sources[0],
    sources,
    destination,
    targetPath: resolveDestination(baseDir, destination),
    rootDir: resolve(baseDir, destination),
    filters: [],
    globs: [],
    iglobs: [],
    preset: null,
    ref: parseSourceOperand(sources[0]).ref,
    as: null,
    force: false
  };

  for (; index < args.length; index++) {
    const arg = args[index];
    if (arg === '-f' || arg === '--force') {
      entry.force = true;
    } else if (arg === '--glob' && args[index + 1]) {
      entry.globs.push(args[++index]);
    } else if (arg === '--iglob' && args[index + 1]) {
      entry.iglobs.push(args[++index]);
    } else if (arg === '--preset' && args[index + 1]) {
      entry.preset = args[++index];
    } else if (arg === '-n' || arg === '--dry-run' || arg === '-q' || arg === '--quiet') {
      // Invocation-level presentation flags are valid but not persisted on the entry.
    } else {
      throw new Error(`Unsupported option in cp-style vlurpfile entry: ${arg}`);
    }
  }

  assertKnownPreset(entry.preset);

  return entry;
}

function parseLegacyEntry(args, baseDir) {
  const source = args[0];
  const entry = {
    mode: 'legacy',
    source,
    sources: [source],
    destination: null,
    rootDir: null,
    filters: [],
    preset: null,
    ref: null,
    as: null,
    force: false
  };

  let rootOption = null;
  for (let index = 1; index < args.length; index++) {
    const arg = args[index];
    if (arg === '-d' && args[index + 1]) {
      rootOption = args[++index];
    } else if (arg === '--filter' && args[index + 1]) {
      entry.filters.push(args[++index]);
    } else if (arg === '--preset' && args[index + 1]) {
      entry.preset = args[++index];
      if (PRESETS[entry.preset]) {
        entry.filters = [...PRESETS[entry.preset].filters];
      }
    } else if (arg === '--ref' && args[index + 1]) {
      entry.ref = args[++index];
    } else if (arg === '--as' && args[index + 1]) {
      entry.as = args[++index];
    } else if (arg === '-f' || arg === '--force') {
      entry.force = true;
    }
  }

  assertKnownPreset(entry.preset);

  entry.rootDir = resolve(baseDir, rootOption ?? '.');
  if (entry.as) {
    entry.targetPath = resolve(entry.rootDir, entry.as);
  } else if (rootOption) {
    const [user, repo] = source.split('/');
    if (user && repo) {
      entry.targetPath = resolve(entry.rootDir, user, repo);
    }
  }

  return entry;
}

function assertKnownPreset(preset) {
  if (preset && !PRESETS[preset]) {
    throw new Error(`Unknown preset "${preset}"`);
  }
}

function updateLineRefs(line, updates) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return line;
  }

  let entry;
  try {
    entry = parseVlurpLine(trimmed);
  } catch {
    return line;
  }

  if (entry.mode === 'copy') {
    let updated = line;
    for (const source of entry.sources) {
      if (updates.has(source)) {
        updated = updated.replace(source, replaceSourceRef(source, updates.get(source)));
      }
    }

    return updated;
  }

  if (!updates.has(entry.source)) {
    return line;
  }

  return replaceLegacyRef(line, updates.get(entry.source));
}

function replaceLegacyRef(line, newRef) {
  const refPattern = /--ref\s+(?:"[^"]*"|'[^']*'|\S+)/;
  if (refPattern.test(line)) {
    return line.replace(refPattern, `--ref ${newRef}`);
  }

  return `${line.trimEnd()} --ref ${newRef}`;
}

/** A small shell-word parser: quoting groups text, but nothing is expanded. */
export function parseArgs(string_) {
  const args = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (const character of string_) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }

    if (character === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote) {
      if (character === quote) {
        quote = null;
      } else {
        current += character;
      }

      continue;
    }

    if (character === '#' && current === '') {
      break;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += character;
    }
  }

  if (quote) {
    throw new Error('Unterminated quote in vlurpfile entry');
  }

  if (escaped) {
    current += '\\';
  }

  if (current) {
    args.push(current);
  }

  return args;
}
