import { strict as assert } from 'node:assert';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
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

  it('filters a cp source with case-sensitive glob rules', async () => {
    const destination = join(temporaryDirectory, 'destination');
    await mkdir(destination);
    const selections = await selectRepositoryEntries(repository, {
      repo: 'repo',
      subpath: '',
      pattern: false,
      raw: 'pkg:github/user/repo'
    });
    const plan = await createCopyPlan(selections, destination, {
      globs: ['**/*.md', '!README.md']
    });

    await executeCopyPlan(plan);
    assert.equal(
      await readFile(join(destination, 'repo', 'skills', 'writing-a', 'SKILL.md'), 'utf8'),
      'a'
    );
    await assert.rejects(readFile(join(destination, 'repo', 'README.md')), /ENOENT/);
  });

  it('filters a cp source with case-insensitive iglob rules', async () => {
    const destination = join(temporaryDirectory, 'destination');
    await mkdir(destination);
    const selections = await selectRepositoryEntries(repository, {
      repo: 'repo',
      subpath: 'skills/writing-a',
      pattern: false,
      raw: 'pkg:github/user/repo#skills/writing-a'
    });
    const plan = await createCopyPlan(selections, destination, {
      iglobs: ['**/skill.md']
    });

    await executeCopyPlan(plan);
    assert.equal(await readFile(join(destination, 'writing-a', 'SKILL.md'), 'utf8'), 'a');
  });

  it('omits selected directories with no matching transfer files', async () => {
    const destination = join(temporaryDirectory, 'destination');
    await mkdir(destination);
    await writeFile(join(repository, 'skills', 'writing-a', 'ONLY.txt'), 'selected');
    const selections = await selectRepositoryEntries(repository, {
      repo: 'repo',
      subpath: 'skills/writing-*',
      pattern: true,
      raw: 'pkg:github/user/repo#skills/writing-*'
    });
    const plan = await createCopyPlan(selections, destination, { globs: ['ONLY.txt'] });

    assert.deepEqual(
      plan.entries.map(entry => entry.basename),
      ['writing-a']
    );
    await executeCopyPlan(plan);
    assert.equal(await readFile(join(destination, 'writing-a', 'ONLY.txt'), 'utf8'), 'selected');
    await assert.rejects(readFile(join(destination, 'writing-b', 'SKILL.md')), /ENOENT/);
  });

  it('allows transfer rules to exclude repository lineage metadata', async () => {
    const destination = join(temporaryDirectory, 'destination');
    await writeFile(join(repository, '.vlurp.jsonl'), 'remote metadata');
    const selections = await selectRepositoryEntries(repository, {
      repo: 'repo',
      subpath: '',
      pattern: false,
      raw: 'pkg:github/user/repo'
    });
    const plan = await createCopyPlan(selections, destination, { globs: ['**/*.md'] });

    await executeCopyPlan(plan);
    assert.equal(await readFile(join(destination, 'README.md'), 'utf8'), 'readme');
  });

  it('rejects symbolic links in filtered destination paths before copying', async () => {
    const destination = join(temporaryDirectory, 'destination');
    const outside = join(temporaryDirectory, 'outside');
    const sourceDirectory = join(repository, 'skills', 'writing-a');
    await mkdir(join(sourceDirectory, 'nested'));
    await writeFile(join(sourceDirectory, 'nested', 'guide.md'), 'safe');
    await mkdir(join(destination, 'writing-a'), { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(destination, 'writing-a', 'nested'));
    const selections = await selectRepositoryEntries(repository, {
      repo: 'repo',
      subpath: 'skills/writing-a',
      pattern: false,
      raw: 'pkg:github/user/repo#skills/writing-a'
    });

    await assert.rejects(
      createCopyPlan(selections, destination, { globs: ['**/*.md'] }),
      /symbolic link/i
    );
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

  it('creates a missing DEST/ and copies a file into it', async () => {
    const destination = join(temporaryDirectory, 'references', 'of-structure');
    const selections = await selectRepositoryEntries(repository, {
      repo: 'repo',
      subpath: 'README.md',
      pattern: false,
      raw: 'pkg:github/user/repo#README.md'
    });
    const plan = await createCopyPlan(selections, `${destination}${sep}`);

    assert.equal(plan.entries[0].targetPath, join(destination, 'README.md'));
    assert.equal(plan.lineageRoot, destination);

    await executeCopyPlan(plan);
    assert.equal(await readFile(join(destination, 'README.md'), 'utf8'), 'readme');
  });

  it('copies a directory beneath a missing DEST/ by basename', async () => {
    const destination = join(temporaryDirectory, 'skills');
    const selections = await selectRepositoryEntries(repository, {
      repo: 'repo',
      subpath: 'skills/writing-a',
      pattern: false,
      raw: 'pkg:github/user/repo#skills/writing-a'
    });
    const plan = await createCopyPlan(selections, `${destination}${sep}`);

    assert.equal(plan.entries[0].targetPath, join(destination, 'writing-a'));
    assert.equal(plan.lineageRoot, destination);

    await executeCopyPlan(plan);
    assert.equal(await readFile(join(destination, 'writing-a', 'SKILL.md'), 'utf8'), 'a');
  });

  it('creates a missing DEST/ for multiple cp sources', async () => {
    const destination = join(temporaryDirectory, 'missing');
    const selections = await selectRepositoryEntries(repository, {
      repo: 'repo',
      subpath: 'skills/writing-*',
      pattern: true,
      raw: 'pkg:github/user/repo#skills/writing-*'
    });
    const plan = await createCopyPlan(selections, `${destination}${sep}`);

    await executeCopyPlan(plan);
    assert.equal(await readFile(join(destination, 'writing-a', 'SKILL.md'), 'utf8'), 'a');
    assert.equal(await readFile(join(destination, 'writing-b', 'SKILL.md'), 'utf8'), 'b');
  });

  it('rejects DEST/ when it names an existing file', async () => {
    const destination = join(temporaryDirectory, 'taken');
    await writeFile(destination, 'not a directory');
    const selections = await selectRepositoryEntries(repository, {
      repo: 'repo',
      subpath: 'README.md',
      pattern: false,
      raw: 'pkg:github/user/repo#README.md'
    });

    await assert.rejects(
      createCopyPlan(selections, `${destination}${sep}`),
      /ends with a path separator but is not a directory/
    );
    assert.equal(await readFile(destination, 'utf8'), 'not a directory');
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
