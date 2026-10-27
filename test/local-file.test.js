import { strict as assert } from 'node:assert';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { detectLocalFileKind, isPathLikeOperand, readLocalFileOperand } from '../src/local-file.js';

describe('local file operands', () => {
  it('treats ., /, and ~ prefixes as paths and leaves owner/repo shorthand alone', () => {
    for (const operand of ['./x/.vlurpfile', '.vlurpfile', '../x', '/tmp/x', '~/x']) {
      assert.equal(isPathLikeOperand(operand), true, operand);
    }

    assert.equal(isPathLikeOperand('owner/repo'), false);
  });

  it('routes JSON lines to restore and everything else to a vlurpfile', () => {
    assert.equal(detectLocalFileKind('\n# lineage\n{"schema":2}\n'), 'lineage');
    assert.equal(detectLocalFileKind("# intent\nvlurp 'pkg:github/a/b' ./b/\n"), 'vlurpfile');
    assert.equal(detectLocalFileKind('owner/repo --preset skills\n'), 'vlurpfile');
    assert.equal(detectLocalFileKind(''), 'vlurpfile');
  });

  it('treats an existing file without a path prefix as local', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'vlurp-local-file-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const file = join(directory, 'lineage');
    await writeFile(file, '{"schema":2}\n');

    assert.equal(isPathLikeOperand(file), true);
    assert.deepEqual(readLocalFileOperand(file), { path: file, kind: 'lineage' });
    assert.throws(() => readLocalFileOperand(directory), /is a directory/);
  });
});
