import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { repoRoot, runCommand, runVlurp } from '../helpers/cli.js';

describe('packed installation', () => {
  it('installs the package and fetches through its resolved production dependencies', async t => {
    const workspace = await mkdtemp(join(tmpdir(), 'vlurp-packed-e2e-'));
    const installDir = join(workspace, 'installed');
    const destination = join(workspace, 'downloads');
    t.after(() => rm(workspace, { recursive: true, force: true }));
    await mkdir(installDir);

    const packed = await runCommand('pnpm', ['pack', '--pack-destination', workspace], {
      cwd: repoRoot
    });
    assert.equal(packed.code, 0, packed.stderr || packed.stdout);

    const tarballName = (await readdir(workspace)).find(name => name.endsWith('.tgz'));
    assert.ok(tarballName, `pnpm pack did not create a tarball\n${packed.stdout}`);
    const tarballPath = join(workspace, tarballName);

    const installed = await runCommand(
      'pnpm',
      ['add', '--ignore-scripts', '--dir', installDir, tarballPath],
      { cwd: workspace, timeout: 120_000 }
    );
    assert.equal(installed.code, 0, installed.stderr || installed.stdout);

    const executable = join(installDir, 'node_modules', 'vlurp', 'bin', 'vlurp');
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
      { cwd: workspace, executable }
    );

    assert.equal(
      result.code,
      0,
      `installed vlurp exited unsuccessfully\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
    assert.doesNotMatch(result.stdout, /Error:/, result.stdout);
    assert.equal(result.stderr, '');

    assert.deepEqual(
      (await readdir(join(destination, 'mattpocock', 'skills', 'skills', 'in-progress'))).sort(),
      ['writing-beats', 'writing-fragments', 'writing-shape']
    );
  });
});
