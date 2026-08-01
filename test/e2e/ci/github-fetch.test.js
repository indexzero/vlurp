import { strict as assert } from 'node:assert';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runVlurp } from '../helpers/cli.js';

describe('GitHub fetch', () => {
  it('downloads a redirected tarball and applies a directory filter', async t => {
    const workspace = await mkdtemp(join(tmpdir(), 'vlurp-e2e-'));
    const destination = join(workspace, 'downloads');
    t.after(() => rm(workspace, { recursive: true, force: true }));

    const result = await runVlurp(
      [
        'mattpocock/skills',
        '--ref',
        '2ab958093e83e0ec752e6c1c5932da465bf23e0c',
        '--filter',
        'skills/in-progress/writing-*',
        '--force',
        '--quiet',
        '-d',
        destination
      ],
      { cwd: workspace }
    );

    assert.equal(
      result.code,
      0,
      `vlurp exited unsuccessfully\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
    assert.doesNotMatch(result.stdout, /Error:/, result.stdout);
    assert.equal(result.stderr, '');

    const fetchedRoot = join(destination, 'mattpocock', 'skills');
    assert.deepEqual(await readdir(fetchedRoot), ['skills']);
    assert.deepEqual(await readdir(join(fetchedRoot, 'skills')), ['in-progress']);
    assert.deepEqual((await readdir(join(fetchedRoot, 'skills', 'in-progress'))).sort(), [
      'writing-beats',
      'writing-fragments',
      'writing-shape'
    ]);
  });
});
