import { cp, lstat, mkdir, readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { glob } from 'glob';
import { compileTransferRules } from './transfer-rules.js';

export async function selectRepositoryEntries(repositoryRoot, source) {
  const root = resolve(repositoryRoot);
  if (!source.subpath) {
    return [await selectionFor(root, source.repo || basename(root), '', source)];
  }

  assertSafeRelativePath(source.subpath);
  if (!source.pattern) {
    const sourcePath = resolve(root, ...source.subpath.split('/'));
    assertContained(root, sourcePath);
    return [await selectionFor(sourcePath, basename(source.subpath), source.subpath, source)];
  }

  const matches = await glob(source.subpath, {
    cwd: root,
    dot: true,
    nodir: false,
    posix: true
  });
  const sorted = [...new Set(matches.map(normalizeRelative))].sort();
  const collapsed = [];
  for (const match of sorted) {
    if (collapsed.some(parent => match.startsWith(`${parent}/`))) {
      continue;
    }

    collapsed.push(match);
  }

  if (collapsed.length === 0) {
    throw new Error(`Source pattern matched no files: ${source.raw || source.subpath}`);
  }

  return Promise.all(
    collapsed.map(match => {
      const sourcePath = resolve(root, ...match.split('/'));
      assertContained(root, sourcePath);
      return selectionFor(sourcePath, basename(match), match, source);
    })
  );
}

export async function createCopyPlan(selections, destination, transferOptions = {}) {
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new Error('At least one source selection is required');
  }

  const destinationPath = resolve(destination);
  const destinationStat = await optionalLstat(destinationPath);
  // A trailing separator names a directory to copy into, created if missing,
  // so DEST/ produces the same layout whether or not it already exists.
  const intoDirectory = endsWithSeparator(destination);
  if (intoDirectory && destinationStat && !destinationStat.isDirectory()) {
    throw new Error(`DEST ends with a path separator but is not a directory: ${destinationPath}`);
  }

  const destinationIsDirectory = destinationStat?.isDirectory() || intoDirectory;
  if (selections.length > 1 && !destinationIsDirectory) {
    throw new Error(
      'When copying multiple sources, DEST must be an existing directory or end with a path separator'
    );
  }

  const entries = [];
  const targets = new Set();
  const transferRules = compileTransferRules(transferOptions);
  for (const selection of selections) {
    await validateSelectionTree(selection.sourcePath);
    const transferFiles = transferRules.active
      ? await selectTransferFiles(selection, transferRules)
      : null;
    if (transferFiles && transferFiles.length === 0) {
      continue;
    }
    if (destinationStat && !destinationIsDirectory && selection.kind === 'directory') {
      throw new Error(
        `Cannot overwrite non-directory DEST with directory ${selection.relativePath}`
      );
    }

    const targetPath = destinationIsDirectory
      ? resolve(destinationPath, selection.basename)
      : destinationPath;
    assertContained(
      destinationIsDirectory ? destinationPath : dirname(destinationPath),
      targetPath,
      {
        allowRoot: !destinationIsDirectory
      }
    );
    if (targets.has(targetPath)) {
      throw new Error(`Source basename collision at destination: ${selection.basename}`);
    }

    const targetStat = await optionalLstat(targetPath);
    if (targetStat?.isSymbolicLink()) {
      throw new Error(`Refusing to overwrite symbolic link at DEST: ${targetPath}`);
    }

    if (targetStat && !targetStat.isFile() && !targetStat.isDirectory()) {
      throw new Error(`Refusing to overwrite special filesystem entry at DEST: ${targetPath}`);
    }

    if (
      targetStat &&
      ((selection.kind === 'directory' && !targetStat.isDirectory()) ||
        (selection.kind === 'file' && !targetStat.isFile()))
    ) {
      throw new Error(`Source and destination types differ at ${targetPath}`);
    }

    if (transferFiles && selection.kind === 'directory') {
      await validateTransferTargets(targetPath, transferFiles);
    }

    targets.add(targetPath);
    entries.push({
      ...selection,
      targetPath,
      exists: Boolean(targetStat),
      transferFiles
    });
  }

  if (entries.length === 0) {
    throw new Error('Transfer rules matched no files beneath the selected sources');
  }

  const plan = {
    destinationPath,
    destinationExisted: Boolean(destinationStat),
    destinationIsDirectory,
    lineageRoot:
      destinationIsDirectory || (!destinationStat && selections[0].kind === 'directory')
        ? destinationPath
        : dirname(destinationPath),
    entries,
    transferRules: {
      globs: transferRules.globs,
      iglobs: transferRules.iglobs,
      preset: transferRules.preset
    }
  };
  await validateReservedTargets(plan);
  return plan;
}

/** True when a DEST operand ends with a path separator, naming a directory. */
export function endsWithSeparator(destination) {
  return sep === '\\' ? /[\\/]$/.test(destination) : destination.endsWith('/');
}

/**
 * Resolve a DEST operand against baseDir, keeping a trailing separator so a
 * resolved DEST/ still names a directory for createCopyPlan.
 */
export function resolveDestination(baseDir, destination) {
  const resolved = resolve(baseDir, destination);
  return endsWithSeparator(destination) && !resolved.endsWith(sep) ? `${resolved}${sep}` : resolved;
}

export async function executeCopyPlan(plan) {
  for (const entry of plan.entries) {
    if (entry.transferFiles) {
      if (entry.kind === 'directory') {
        await mkdir(entry.targetPath, { recursive: true });
      }

      for (const file of entry.transferFiles) {
        const sourcePath = file ? resolve(entry.sourcePath, ...file.split('/')) : entry.sourcePath;
        const targetPath = file ? resolve(entry.targetPath, ...file.split('/')) : entry.targetPath;
        await mkdir(dirname(targetPath), { recursive: true });
        await cp(sourcePath, targetPath, { force: true, errorOnExist: false });
      }

      continue;
    }

    await mkdir(dirname(entry.targetPath), { recursive: true });
    await cp(entry.sourcePath, entry.targetPath, {
      recursive: entry.kind === 'directory',
      force: true,
      errorOnExist: false
    });
  }
}

export async function listCopiedFiles(plan) {
  const files = [];
  for (const entry of plan.entries) {
    if (entry.transferFiles) {
      for (const file of entry.transferFiles) {
        const targetPath = file ? resolve(entry.targetPath, ...file.split('/')) : entry.targetPath;
        files.push(relative(plan.lineageRoot, targetPath));
      }

      continue;
    }

    if (entry.kind === 'file') {
      files.push(relative(plan.lineageRoot, entry.targetPath));
      continue;
    }

    await walk(entry.targetPath, path => files.push(relative(plan.lineageRoot, path)));
  }

  return [...new Set(files)].sort();
}

async function selectTransferFiles(selection, rules) {
  if (selection.kind === 'file') {
    return rules.matches(selection.basename) ? [''] : [];
  }

  const files = [];
  await walk(selection.sourcePath, path => {
    const relativePath = normalizeRelative(relative(selection.sourcePath, path));
    if (rules.matches(relativePath)) {
      files.push(relativePath);
    }
  });
  return files.sort();
}

async function selectionFor(sourcePath, selectedBasename, relativePath, source) {
  const stat = await optionalLstat(sourcePath);
  if (!stat) {
    throw new Error(`Source path does not exist: ${relativePath || '.'}`);
  }

  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to copy symbolic link: ${relativePath}`);
  }

  if (!stat.isFile() && !stat.isDirectory()) {
    throw new Error(`Unsupported source entry type: ${relativePath}`);
  }

  return {
    source,
    sourcePath,
    relativePath,
    basename: selectedBasename,
    kind: stat.isDirectory() ? 'directory' : 'file'
  };
}

async function walk(directory, onFile) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to record symbolic link: ${path}`);
    }

    if (entry.isDirectory()) {
      await walk(path, onFile);
    } else if (entry.isFile()) {
      onFile(path);
    }
  }
}

async function validateSelectionTree(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`Refusing to copy symbolic link: ${path}`);
  }

  if (stat.isFile()) {
    return;
  }

  if (!stat.isDirectory()) {
    throw new Error(`Refusing to copy special filesystem entry: ${path}`);
  }

  const entries = await readdir(path);
  for (const entry of entries) {
    await validateSelectionTree(resolve(path, entry));
  }
}

async function validateReservedTargets(plan) {
  for (const reservedName of ['.vlurp.jsonl', '.vlurp.sigstore']) {
    const reservedPath = resolve(plan.lineageRoot, reservedName);
    for (const entry of plan.entries) {
      if (entry.kind === 'file' && entry.targetPath === reservedPath) {
        throw new Error(`Source would overwrite reserved vlurp metadata: ${reservedName}`);
      }

      if (entry.kind !== 'directory') {
        continue;
      }

      const mappedRelative = relative(entry.targetPath, reservedPath);
      if (
        mappedRelative === '..' ||
        mappedRelative.startsWith(`..${sep}`) ||
        isAbsolute(mappedRelative)
      ) {
        continue;
      }

      if (entry.transferFiles && !entry.transferFiles.includes(normalizeRelative(mappedRelative))) {
        continue;
      }

      if (await optionalLstat(resolve(entry.sourcePath, mappedRelative))) {
        throw new Error(`Source would overwrite reserved vlurp metadata: ${reservedName}`);
      }
    }
  }
}

async function validateTransferTargets(targetRoot, transferFiles) {
  for (const file of transferFiles) {
    const segments = file.split('/');
    let path = targetRoot;
    for (const [index, segment] of segments.entries()) {
      path = resolve(path, segment);
      assertContained(targetRoot, path);
      const stat = await optionalLstat(path);
      if (!stat) {
        continue;
      }

      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to copy through symbolic link at DEST: ${path}`);
      }

      const isFile = index === segments.length - 1;
      if ((isFile && !stat.isFile()) || (!isFile && !stat.isDirectory())) {
        throw new Error(`Source and destination types differ at ${path}`);
      }
    }
  }
}

export function assertSafeRelativePath(path, label = 'repository subpath') {
  if (
    typeof path !== 'string' ||
    isAbsolute(path) ||
    path.startsWith('\\') ||
    path.includes('\0')
  ) {
    throw new Error(`Unsafe ${label}: ${path}`);
  }

  const segments = path.split('/');
  if (segments.some(segment => segment === '..' || segment === '.' || segment === '')) {
    throw new Error(`Unsafe ${label}: ${path}`);
  }
}

export function assertContained(root, path, { allowRoot = true } = {}) {
  const rel = relative(resolve(root), resolve(path));
  if ((!allowRoot && rel === '') || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Unsafe path escapes destination or repository root: ${path}`);
  }
}

function normalizeRelative(path) {
  return path.replaceAll('\\', '/').replace(/\/$/, '');
}

export async function optionalLstat(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}
