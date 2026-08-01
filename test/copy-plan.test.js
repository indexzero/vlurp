import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createCopyPlan, executeCopyPlan, selectRepositoryEntries } from '../src/copy-plan.js';

describe('cp-style copy planning', () => {
  let temporaryDirectory;
  let repository;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'vlurp-copy-plan-'));
    repository = join(temporaryDirectory, 'repo');
    await mkdir(join(repository, 'skills', 'writing-a'), { recursive: true });
    await mkdir(join(repository, 'skills', 'writing-b'), { recursive: true });
    await writeFile(join(repository, 'skills', 'writing-a', 'SKILL.md'), 'a');
    await writeFile(join(repository, 'skills', 'writing-b', 'SKILL.md'), 'b');
    await writeFile(join(repository, 'README.md'), 'readme');
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('selects glob matches as independent cp sources', async () => {
    const matches = await selectRepositoryEntries(repository, {
      repo: 'repo',
      subpath: 'skills/writing-*',
      pattern: true
    });

    assert.deepEqual(
      matches.map(match => match.relativePath),
      ['skills/writing-a', 'skills/writing-b']
    );
  });

  it('copies matched basenames into an existing destination directory', async () => {
    const destination = join(temporaryDirectory, 'destination');
    await mkdir(destination);
    const selections = await selectRepositoryEntries(repository, {
      repo: 'repo',
      subpath: 'skills/writing-*',
      pattern: true,
      raw: 'pkg:github/user/repo#skills/writing-*'
    });
    const plan = await createCopyPlan(selections, destination);

    assert.deepEqual(
      plan.entries.map(entry => entry.targetPath),
      [join(destination, 'writing-a'), join(destination, 'writing-b')]
    );

    await executeCopyPlan(plan);
    assert.equal(await readFile(join(destination, 'writing-a', 'SKILL.md'), 'utf8'), 'a');
    assert.equal(await readFile(join(destination, 'writing-b', 'SKILL.md'), 'utf8'), 'b');
  });

  it('makes a missing destination the copied file itself', async () => {
    const destination = join(temporaryDirectory, 'renamed.md');
    const selections = await selectRepositoryEntries(repository, {
      repo: 'repo',
      subpath: 'README.md',
      pattern: false,
      raw: 'pkg:github/user/repo#README.md'
    });
    const plan = await createCopyPlan(selections, destination);

    assert.equal(plan.entries[0].targetPath, destination);
  });

  it('requires an existing directory for multiple cp sources', async () => {
    const selections = await selectRepositoryEntries(repository, {
      repo: 'repo',
      subpath: 'skills/writing-*',
      pattern: true,
      raw: 'pkg:github/user/repo#skills/writing-*'
    });

    await assert.rejects(
      createCopyPlan(selections, join(temporaryDirectory, 'missing')),
      /existing directory/i
    );
  });

  it('rejects basename collisions before copying', async () => {
    const destination = join(temporaryDirectory, 'destination');
    await mkdir(destination);
    const source = join(repository, 'README.md');
    const selection = {
      sourcePath: source,
      relativePath: 'README.md',
      basename: 'README.md',
      kind: 'file'
    };

    await assert.rejects(createCopyPlan([selection, selection], destination), /collision/i);
  });

  it('rejects nested symbolic links before copying anything', async () => {
    const destination = join(temporaryDirectory, 'destination');
    const sourceDirectory = join(repository, 'skills', 'writing-a');
    await symlink(join(repository, 'README.md'), join(sourceDirectory, 'linked.md'));
    const selections = [
      {
        sourcePath: sourceDirectory,
        relativePath: 'skills/writing-a',
        basename: 'writing-a',
        kind: 'directory'
      }
    ];

    await assert.rejects(createCopyPlan(selections, destination), /symbolic link/i);
    await assert.rejects(readFile(destination), /ENOENT/);
  });

  it('does not let remote content replace lineage metadata', async () => {
    await writeFile(join(repository, '.vlurp.jsonl'), '{"forged":true}\n');
    const selections = await selectRepositoryEntries(repository, {
      repo: 'repo',
      subpath: '',
      pattern: false,
      raw: 'pkg:github/user/repo'
    });

    await assert.rejects(
      createCopyPlan(selections, join(temporaryDirectory, 'renamed-repo')),
      /reserved vlurp metadata/i
    );
  });

  it('never resolves a selected path outside the materialized repository', async () => {
    await assert.rejects(
      selectRepositoryEntries(repository, {
        repo: 'repo',
        subpath: '../secret',
        pattern: false
      }),
      /unsafe/i
    );
    assert.equal(resolve(repository, '../secret').startsWith(`${resolve(repository)}/`), false);
  });
});
