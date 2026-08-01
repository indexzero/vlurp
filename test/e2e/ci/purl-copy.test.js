import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runVlurp } from '../helpers/cli.js';

describe('PURL copy', () => {
  it('copies live GitHub glob matches with cp basename semantics', async t => {
    const workspace = await mkdtemp(join(tmpdir(), 'vlurp-purl-e2e-'));
    const destination = join(workspace, 'skills');
    t.after(() => rm(workspace, { recursive: true, force: true }));

    await mkdir(destination);
    const source =
      'pkg:github/mattpocock/skills@2ab958093e83e0ec752e6c1c5932da465bf23e0c#skills/in-progress/writing-*';
    const result = await runVlurp(
      [
        source,
        destination,
        '--preset',
        'skills',
        '--glob',
        '!README.md',
        '--iglob',
        '**/skill.md',
        '--force',
        '--quiet'
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
    assert.deepEqual((await readdir(destination)).sort(), [
      '.vlurp.jsonl',
      'writing-beats',
      'writing-fragments',
      'writing-shape'
    ]);
    for (const directory of ['writing-beats', 'writing-fragments', 'writing-shape']) {
      assert.deepEqual(await readdir(join(destination, directory)), ['SKILL.md']);
    }
  });
});
