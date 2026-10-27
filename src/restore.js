import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import {
  assertContained,
  assertSafeRelativePath,
  optionalLstat,
  selectRepositoryEntries
} from './copy-plan.js';
import { hashFile, readLineageStrict } from './lineage.js';
import { Fetcher } from './remote.js';
import { parseSourceOperand, sourceRepositoryKey } from './source-operand.js';

const RESERVED_NAMES = new Set(['.vlurp.jsonl', '.vlurp.sigstore']);
const SHA256_PATTERN = /^[a-f\d]{64}$/;

/**
 * Restore the files recorded in a .vlurp.jsonl from their upstream sources.
 *
 * Restore is content-addressed rather than a replay of the original copy:
 * each record's `files` keys are the layout, and the bytes for a key come
 * from whichever file inside the record's PURL selection has the recorded
 * sha256. Every file across every record is fetched and verified before
 * anything is written, only recorded paths are written, and .vlurp.jsonl
 * itself is never written.
 *
 * File actions: `fetch` (missing locally), `skip` (hash already matches),
 * `overwrite` (modified locally and force is set), and `refuse` (modified
 * locally without force; a real restore fails before any network access).
 */
export async function restoreLineage({
  lineagePath,
  force = false,
  dryRun = false,
  fetcher = new Fetcher()
}) {
  const resolvedLineagePath = resolve(lineagePath);
  const root = dirname(resolvedLineagePath);
  const records = loadRecords(await readLineageStrict(resolvedLineagePath), resolvedLineagePath);
  if (records.length === 0) {
    throw new Error(`No lineage records found at ${resolvedLineagePath}`);
  }

  const { files, recordOf } = collectFiles(root, records);
  for (const file of files) {
    file.state = await inspectTarget(root, file);
    file.action = actionFor(file.state, force);
  }

  const result = {
    status: dryRun ? 'dry-run' : 'complete',
    lineagePath: resolvedLineagePath,
    root,
    records: records.length,
    files,
    warnings: records
      .filter(record => !record.source.ref)
      .map(
        record =>
          `${record.source.raw} is not pinned; restoring from the default branch HEAD (recorded hashes are still enforced)`
      )
  };

  if (dryRun) {
    return result;
  }

  assertNoRefusals(files, force);
  const pending = files.filter(file => file.action === 'fetch' || file.action === 'overwrite');
  if (pending.length === 0) {
    return result;
  }

  const staged = await fetchVerified(pending, recordOf, fetcher);

  // The network round trip can take a while; re-check the targets so a file
  // edited or replaced in the meantime is not clobbered.
  for (const file of pending) {
    file.state = await inspectTarget(root, file);
    if (actionFor(file.state, force) === 'refuse') {
      file.action = 'refuse';
    }
  }

  assertNoRefusals(files, force);
  await writeStaged(staged);
  return result;
}

function loadRecords(entries, lineagePath) {
  return entries.map(({ line, record }) => {
    const where = `${lineagePath}:${line}`;
    if (
      record.schema !== 2 ||
      typeof record.source !== 'string' ||
      !record.source.startsWith('pkg:') ||
      record.files_root_relative !== true
    ) {
      const label = typeof record.source === 'string' ? ` for ${record.source}` : '';
      throw new Error(
        `${where}: legacy lineage record${label} cannot be restored; re-fetch it with a PURL source (vlurp 'pkg:github/<owner>/<repo>@<ref>#<path>' DEST) to record restorable lineage`
      );
    }

    let source;
    try {
      source = parseSourceOperand(record.source);
    } catch (error) {
      throw new Error(`${where}: ${error.message}`);
    }

    if ((record.ref ?? null) !== source.ref) {
      throw new Error(
        `${where}: recorded ref ${JSON.stringify(record.ref)} does not match the ref in ${record.source}`
      );
    }

    if (!record.files || typeof record.files !== 'object' || Array.isArray(record.files)) {
      throw new Error(`${where}: lineage record for ${record.source} has no files map`);
    }

    const files = Object.entries(record.files).map(([path, meta]) => {
      if (!meta || typeof meta.sha256 !== 'string' || !SHA256_PATTERN.test(meta.sha256)) {
        throw new Error(`${where}: ${path} does not record a valid sha256`);
      }

      if (meta.size !== undefined && !(Number.isSafeInteger(meta.size) && meta.size >= 0)) {
        throw new Error(`${where}: ${path} records an invalid size`);
      }

      return { path, sha256: meta.sha256, size: meta.size ?? null };
    });

    return { line, source, files };
  });
}

function collectFiles(root, records) {
  const byPath = new Map();
  const recordOf = new Map();
  for (const record of records) {
    for (const file of record.files) {
      assertSafeRelativePath(file.path, 'lineage path');
      if (RESERVED_NAMES.has(file.path)) {
        throw new Error(`Lineage path would overwrite reserved vlurp metadata: ${file.path}`);
      }

      const targetPath = resolve(root, ...splitLineagePath(file.path));
      assertContained(root, targetPath, { allowRoot: false });

      const existing = byPath.get(file.path);
      if (existing) {
        if (existing.sha256 !== file.sha256) {
          throw new Error(
            `Conflicting lineage for ${file.path}: ${existing.source} and ${record.source.raw} record different sha256 values`
          );
        }

        continue;
      }

      const entry = {
        path: file.path,
        sha256: file.sha256,
        size: file.size,
        targetPath,
        source: record.source.raw,
        ref: record.source.ref
      };
      byPath.set(file.path, entry);
      recordOf.set(entry, record);
    }
  }

  for (const path of byPath.keys()) {
    const segments = splitLineagePath(path);
    for (let index = 1; index < segments.length; index++) {
      const ancestor = segments.slice(0, index).join('/');
      if (byPath.has(ancestor)) {
        throw new Error(`Lineage records ${ancestor} as both a file and a directory`);
      }
    }
  }

  const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { files, recordOf };
}

async function inspectTarget(root, file) {
  const segments = splitLineagePath(file.path);
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = resolve(current, segment);
    const stat = await optionalLstat(current);
    if (!stat) {
      return 'missing';
    }

    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to restore through symbolic link: ${current}`);
    }

    const isTarget = index === segments.length - 1;
    if (!isTarget && !stat.isDirectory()) {
      throw new Error(`Cannot restore ${file.path}: ${current} is not a directory`);
    }

    if (isTarget && !stat.isFile()) {
      throw new Error(
        `Refusing to overwrite ${stat.isDirectory() ? 'directory' : 'special filesystem entry'} at ${current}`
      );
    }
  }

  const { sha256 } = await hashFile(file.targetPath);
  return sha256 === file.sha256 ? 'unchanged' : 'modified';
}

function actionFor(state, force) {
  if (state === 'missing') {
    return 'fetch';
  }

  if (state === 'unchanged') {
    return 'skip';
  }

  return force ? 'overwrite' : 'refuse';
}

function assertNoRefusals(files, force) {
  const refused = files.filter(file => actionFor(file.state, force) === 'refuse');
  if (refused.length === 0) {
    return;
  }

  const error = new Error(
    [
      `Refusing to overwrite ${refused.length} locally modified file(s); nothing was written:`,
      ...refused.map(file => `  modified     ${file.path}`),
      'Re-run with --force to replace them with the recorded upstream bytes.'
    ].join('\n')
  );
  error.files = files;
  throw error;
}

async function fetchVerified(pending, recordOf, fetcher) {
  const groups = new Map();
  for (const file of pending) {
    const record = recordOf.get(file);
    if (!groups.has(record)) {
      groups.set(record, []);
    }

    groups.get(record).push(file);
  }

  const materialized = new Map();
  const staged = [];
  try {
    for (const [record, files] of groups) {
      const { source } = record;
      const materializationKey = `${sourceRepositoryKey(source)}@${source.ref || 'HEAD'}`;
      let repository = materialized.get(materializationKey);
      if (!repository) {
        try {
          repository = await fetcher.materialize(source.tarballUrl);
        } catch (error) {
          throw new Error(`${source.raw}: ${error.message}; nothing was written`);
        }

        materialized.set(materializationKey, repository);
      }

      const candidates = await indexUpstream(repository.path, source, files);
      for (const file of files) {
        const matches = candidates.get(file.sha256) || [];
        const wantedName = basename(file.targetPath);
        const chosen = matches.find(path => basename(path) === wantedName) || matches[0];
        const bytes = chosen ? await readFile(chosen) : null;
        if (!bytes || sha256(bytes) !== file.sha256) {
          throw new Error(
            `${source.raw}: upstream content for ${file.path} no longer matches the recorded sha256 at ${source.ref || 'HEAD'}; nothing was written`
          );
        }

        staged.push({ file, bytes });
      }
    }
  } finally {
    await Promise.all([...materialized.values()].map(repository => repository.cleanup()));
  }

  return staged;
}

/**
 * Hash the files inside a source's selection, returning sha256 -> sorted
 * absolute paths for hashes that some pending file needs.
 */
async function indexUpstream(repositoryPath, source, files) {
  const wanted = new Set(files.map(file => file.sha256));
  const sizes = files.every(file => file.size !== null)
    ? new Set(files.map(file => file.size))
    : null;

  let selections;
  try {
    selections = await selectRepositoryEntries(repositoryPath, source);
  } catch (error) {
    throw new Error(`${source.raw}: ${error.message}; nothing was written`);
  }

  const candidates = new Map();
  const consider = async path => {
    if (sizes && !sizes.has((await lstat(path)).size)) {
      return;
    }

    const { sha256: hash } = await hashFile(path);
    if (!wanted.has(hash)) {
      return;
    }

    if (!candidates.has(hash)) {
      candidates.set(hash, []);
    }

    candidates.get(hash).push(path);
  };

  for (const selection of selections) {
    if (selection.kind === 'file') {
      await consider(selection.sourcePath);
    } else {
      await walkFiles(selection.sourcePath, consider);
    }
  }

  for (const paths of candidates.values()) {
    paths.sort();
  }

  return candidates;
}

async function walkFiles(directory, onFile) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(path, onFile);
    } else if (entry.isFile()) {
      await onFile(path);
    }
  }
}

/**
 * Write every verified file to a temporary sibling first, then rename them
 * into place, so a failed write leaves the destination untouched.
 */
async function writeStaged(staged) {
  const temporaries = [];
  try {
    for (const { file, bytes } of staged) {
      const directory = dirname(file.targetPath);
      await mkdir(directory, { recursive: true });
      const temporaryPath = join(
        directory,
        `.${basename(file.targetPath)}.vlurp-${randomBytes(6).toString('hex')}.tmp`
      );
      temporaries.push({ temporaryPath, targetPath: file.targetPath });
      await writeFile(temporaryPath, bytes, { flag: 'wx' });
    }
  } catch (error) {
    await Promise.all(temporaries.map(({ temporaryPath }) => rm(temporaryPath, { force: true })));
    throw error;
  }

  for (const { temporaryPath, targetPath } of temporaries) {
    await rename(temporaryPath, targetPath);
  }
}

function splitLineagePath(path) {
  return path.split(sep === '\\' ? /[\\/]/ : '/');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
