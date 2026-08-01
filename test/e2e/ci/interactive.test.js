import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import { runVlurpInPty } from '../helpers/cli.js';

const describePty = process.platform === 'linux' ? describe : describe.skip;

describePty('interactive CLI', () => {
  it('prompts for a PURL destination collision and cancels semantically', async t => {
    const workspace = await mkdtemp(join(tmpdir(), 'vlurp-purl-pty-e2e-'));
    const destination = join(workspace, 'skills');
    const target = join(destination, 'writing-beats');
    const marker = join(target, 'keep.txt');
    t.after(() => rm(workspace, { recursive: true, force: true }));

    await mkdir(target, { recursive: true });
    await writeFile(marker, 'keep me');
    const source =
      'pkg:github/mattpocock/skills@2ab958093e83e0ec752e6c1c5932da465bf23e0c#skills/in-progress/writing-beats';
    const cli = runVlurpInPty([source, destination, '--quiet'], { cwd: workspace });

    await cli.waitForText('Continue? (y/N):');
    assert.match(cli.output, /1 destination path\(s\) already exist/);

    cli.write('n\r');
    const exit = await cli.waitForExit();

    assert.equal(exit.exitCode, 0, cli.transcript);
    assert.match(cli.output, /vlurping cancelled/);
    assert.equal(await readFile(marker, 'utf8'), 'keep me');
  });

  it('prompts before overwriting and preserves files when cancelled', async t => {
    const workspace = await mkdtemp(join(tmpdir(), 'vlurp-pty-e2e-'));
    const destination = join(workspace, 'downloads');
    const target = join(destination, 'mattpocock', 'skills');
    const marker = join(target, 'keep.txt');
    t.after(() => rm(workspace, { recursive: true, force: true }));

    await mkdir(target, { recursive: true });
    await writeFile(marker, 'keep me');

    const cli = runVlurpInPty(['mattpocock/skills', '--quiet', '-d', destination], {
      cwd: workspace
    });

    await cli.waitForText('Continue? (y/N):');
    assert.match(cli.output, /already exists with 1 files/);

    cli.write('n\r');
    const exit = await cli.waitForExit();

    assert.equal(exit.exitCode, 0, cli.transcript);
    assert.match(cli.output, /vlurping cancelled/);
    assert.equal(await readFile(marker, 'utf8'), 'keep me');
  });
});
