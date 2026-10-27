import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/**
 * A first positional is a local file when it looks like a path (GitHub owners
 * cannot start with ".", "/", or "~") or names an existing regular file.
 */
export function isPathLikeOperand(operand) {
  if (/^[./~\\]/.test(operand) || isAbsolute(operand)) {
    return true;
  }

  try {
    return statSync(operand).isFile();
  } catch {
    return false;
  }
}

/**
 * Route a local file by content: if the first meaningful line (not blank and
 * not a # comment) is a JSON object, it is lineage (.vlurp.jsonl) to restore;
 * otherwise it is a .vlurpfile to run.
 */
export function detectLocalFileKind(content) {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    return trimmed.startsWith('{') ? 'lineage' : 'vlurpfile';
  }

  return 'vlurpfile';
}

/** Resolve, read, and classify a local file operand. */
export function readLocalFileOperand(operand) {
  const path = resolve(expandHome(operand));
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      throw new Error(`No such file: ${operand}`);
    }

    throw error;
  }

  if (stat.isDirectory()) {
    throw new Error(
      `${operand} is a directory; pass a .vlurpfile or .vlurp.jsonl file path (restoring a whole directory is not supported yet)`
    );
  }

  if (!stat.isFile()) {
    throw new Error(`${operand} is not a regular file`);
  }

  return { path, kind: detectLocalFileKind(readFileSync(path, 'utf8')) };
}

function expandHome(operand) {
  if (operand === '~') {
    return homedir();
  }

  if (operand.startsWith('~/')) {
    return join(homedir(), operand.slice(2));
  }

  return operand;
}
