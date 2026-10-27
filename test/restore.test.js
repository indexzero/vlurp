import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { copySources } from '../src/copy-sources.js';
import { hashDirectory, readLineage, verifyFiles } from '../src/lineage.js';
import { restoreLineage } from '../src/restore.js';

const sha256 = content => createHash('sha256').update(content).digest('hex');

const exists = path =>
  access(path).then(
    () => true,
    () => false
  );

describe('restoreLineage', () => {
  let temporaryDirectory;
  let fixtureRepository;
  let destination;
  let fetcher;
  let materializeCalls;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'vlurp-restore-'));
    fixtureRepository = join(temporaryDirectory, 'fixture');
    destination = join(temporaryDirectory, 'skills');
    await mkdir(join(fixtureRepository, 'skills', 'writing-a', 'refs'), { recursive: true });
    await mkdir(join(fixtureRepository, 'skills', 'writing-b'), { recursive: true });
    await mkdir(destination);
    await writeFile(join(fixtureRepository, 'skills', 'writing-a', 'SKILL.md'), 'a');
    await writeFile(join(fixtureRepository, 'skills', 'writing-a', 'refs', 'notes.md'), 'notes');
    await writeFile(join(fixtureRepository, 'skills', 'writing-b', 'SKILL.md'), 'b');
    await writeFile(join(fixtureRepository, 'README.md'), 'boilerplate');

    materializeCalls = [];
    fetcher = {
      async materialize(tarballUrl) {
        materializeCalls.push(tarballUrl);
        const materialized = await mkdtemp(join(tmpdir(), 'vlurp-materialized-'));
        await cp(fixtureRepository, materialized, { recursive: true });
        return {
          path: materialized,
          cleanup: () => rm(materialized, { recursive: true, force: true })
        };
      }
    };
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  const offlineFetcher = {
    async materialize() {
      throw new Error('network access is not allowed in this test');
    }
  };

  async function copyGlob() {
    await copySources({
      sources: ['pkg:github/user/repo@abc1234#skills/writing-*'],
      destination,
      force: true,
      fetcher
    });
    materializeCalls = [];
    return join(destination, '.vlurp.jsonl');
  }

  async function writeRecord(directory, record) {
    const lineagePath = join(directory, '.vlurp.jsonl');
    await writeFile(lineagePath, `${JSON.stringify(record)}\n`);
    return lineagePath;
  }

  function copyRecord(files, source = 'pkg:github/user/repo@abc1234#skills/writing-a') {
    const ref = /@([^#]+)/.exec(source)?.[1] || null;
    return {
      schema: 2,
      source,
      lineage_key: 'github:user/repo#skills/writing-a',
      ref,
      ref_type: ref ? 'git' : null,
      fetched_at: '2026-10-26T00:00:00.000Z',
      destination: '.',
      globs: [],
      iglobs: [],
      preset: null,
      files_root_relative: true,
      files
    };
  }

  it('restores a missing file and leaves matching files alone', async () => {
    const lineagePath = await copyGlob();
    await unlink(join(destination, 'writing-b', 'SKILL.md'));

    const result = await restoreLineage({ lineagePath, fetcher });

    assert.equal(result.status, 'complete');
    assert.deepEqual(
      result.files.map(file => [file.path, file.action]),
      [
        ['writing-a/refs/notes.md', 'skip'],
        ['writing-a/SKILL.md', 'skip'],
        ['writing-b/SKILL.md', 'fetch']
      ].sort((a, b) => a[0].localeCompare(b[0]))
    );
    assert.equal(await readFile(join(destination, 'writing-b', 'SKILL.md'), 'utf8'), 'b');
    assert.deepEqual(materializeCalls, ['https://api.github.com/repos/user/repo/tarball/abc1234']);
  });

  it('skips files whose hash already matches without touching the network', async () => {
    const lineagePath = await copyGlob();

    const result = await restoreLineage({ lineagePath, fetcher: offlineFetcher });

    assert.equal(result.status, 'complete');
    assert.ok(result.files.length > 0);
    assert.ok(result.files.every(file => file.state === 'unchanged' && file.action === 'skip'));
  });

  it('fails on a locally modified file without --force and overwrites it with --force', async () => {
    const lineagePath = await copyGlob();
    const skillPath = join(destination, 'writing-a', 'SKILL.md');
    await writeFile(skillPath, 'local edit');
    await unlink(join(destination, 'writing-b', 'SKILL.md'));

    await assert.rejects(restoreLineage({ lineagePath, fetcher }), error => {
      assert.match(error.message, /modified/);
      assert.match(error.message, /writing-a\/SKILL\.md/);
      assert.equal(error.files.find(file => file.path === 'writing-a/SKILL.md').state, 'modified');
      return true;
    });
    assert.equal(await readFile(skillPath, 'utf8'), 'local edit');
    assert.equal(await exists(join(destination, 'writing-b', 'SKILL.md')), false);
    assert.equal(materializeCalls.length, 0);

    const result = await restoreLineage({ lineagePath, fetcher, force: true });
    assert.equal(result.files.find(file => file.path === 'writing-a/SKILL.md').action, 'overwrite');
    assert.equal(await readFile(skillPath, 'utf8'), 'a');
    assert.equal(await readFile(join(destination, 'writing-b', 'SKILL.md'), 'utf8'), 'b');
  });

  it('writes nothing when any upstream hash no longer matches', async () => {
    const lineagePath = await copyGlob();
    await rm(join(destination, 'writing-a'), { recursive: true });
    await rm(join(destination, 'writing-b'), { recursive: true });
    await writeFile(join(fixtureRepository, 'skills', 'writing-b', 'SKILL.md'), 'tampered');

    await assert.rejects(
      restoreLineage({ lineagePath, fetcher }),
      /upstream content for writing-b\/SKILL\.md no longer matches the recorded sha256 at abc1234/
    );

    // writing-a files would have verified, but all-or-nothing means none land.
    assert.equal(await exists(join(destination, 'writing-a')), false);
    assert.equal(await exists(join(destination, 'writing-b')), false);
  });

  it('rejects parent-directory and absolute lineage paths before any network access', async () => {
    const contained = join(temporaryDirectory, 'contained');
    await mkdir(contained);

    for (const key of [
      '../escaped.md',
      'nested/../../escaped.md',
      join(temporaryDirectory, 'abs.md')
    ]) {
      const lineagePath = await writeRecord(
        contained,
        copyRecord({ [key]: { sha256: sha256('a'), size: 1 } })
      );
      await assert.rejects(
        restoreLineage({ lineagePath, fetcher: offlineFetcher }),
        /Unsafe lineage path/,
        key
      );
    }

    assert.equal(await exists(join(temporaryDirectory, 'escaped.md')), false);
    assert.equal(await exists(join(temporaryDirectory, 'abs.md')), false);
  });

  it('refuses to write .vlurp.jsonl or through a symbolic link', async () => {
    const lineagePath = await writeRecord(
      destination,
      copyRecord({ '.vlurp.jsonl': { sha256: sha256('a'), size: 1 } })
    );
    await assert.rejects(
      restoreLineage({ lineagePath, fetcher: offlineFetcher }),
      /reserved vlurp metadata/
    );

    const outside = join(temporaryDirectory, 'outside');
    await mkdir(outside);
    await symlink(outside, join(destination, 'linked'));
    await writeRecord(
      destination,
      copyRecord({ 'linked/SKILL.md': { sha256: sha256('a'), size: 1 } })
    );
    await assert.rejects(restoreLineage({ lineagePath, fetcher }), /symbolic link/);
    assert.equal(await exists(join(outside, 'SKILL.md')), false);
  });

  it('rejects legacy records with a re-fetch hint', async () => {
    const lineagePath = await writeRecord(destination, {
      source: 'github:user/repo',
      ref: 'abc1234',
      ref_type: 'commit',
      fetched_at: '2026-10-26T00:00:00.000Z',
      filters: [],
      preset: null,
      as: null,
      files: { 'SKILL.md': { sha256: sha256('a'), size: 1 } }
    });

    await assert.rejects(
      restoreLineage({ lineagePath, fetcher: offlineFetcher }),
      /legacy lineage record for github:user\/repo cannot be restored; re-fetch it with a PURL source/
    );
  });

  it('rejects a malformed line instead of skipping it', async () => {
    const lineagePath = join(destination, '.vlurp.jsonl');
    await writeFile(
      lineagePath,
      `${JSON.stringify(copyRecord({ 'SKILL.md': { sha256: sha256('a'), size: 1 } }))}\n{"schema":2,\n`
    );

    await assert.rejects(
      restoreLineage({ lineagePath, fetcher: offlineFetcher }),
      /\.vlurp\.jsonl:2: malformed lineage record/
    );
    // verify keeps its tolerant reader.
    assert.equal((await readLineage(lineagePath)).length, 1);
  });

  it('round-trips a directory copied into a missing DEST', async () => {
    // Identical bytes at two upstream paths exercise content addressing.
    await writeFile(join(fixtureRepository, 'skills', 'writing-a', 'copy.md'), 'a');
    const namedDestination = join(temporaryDirectory, 'named-skill');
    await copySources({
      sources: ['pkg:github/user/repo@abc1234#skills/writing-a'],
      destination: namedDestination,
      force: true,
      fetcher
    });

    const lineagePath = join(namedDestination, '.vlurp.jsonl');
    const lineageBefore = await readFile(lineagePath);
    const layoutBefore = await hashDirectory(namedDestination);
    assert.equal(JSON.parse(lineageBefore.toString()).destination, '.');

    for (const entry of ['SKILL.md', 'copy.md', 'refs']) {
      await rm(join(namedDestination, entry), { recursive: true });
    }
    assert.deepEqual(Object.keys(await hashDirectory(namedDestination)), ['.vlurp.jsonl']);

    const result = await restoreLineage({ lineagePath, fetcher });

    assert.equal(result.status, 'complete');
    assert.deepEqual(await hashDirectory(namedDestination), layoutBefore);
    assert.deepEqual(await readFile(lineagePath), lineageBefore);
    const verification = await verifyFiles(namedDestination, await readLineage(lineagePath));
    assert.equal(verification.filter(entry => entry.status !== 'ok').length, 0);
  });

  it('fetches each repository and ref once across records', async () => {
    for (const source of [
      'pkg:github/user/repo@abc1234#skills/writing-a',
      'pkg:github/user/repo@abc1234#skills/writing-b'
    ]) {
      await copySources({ sources: [source], destination, force: true, fetcher });
    }
    const lineagePath = join(destination, '.vlurp.jsonl');
    assert.equal((await readLineage(lineagePath)).length, 2);
    await rm(join(destination, 'writing-a'), { recursive: true });
    await rm(join(destination, 'writing-b'), { recursive: true });
    materializeCalls = [];

    const result = await restoreLineage({ lineagePath, fetcher });

    assert.equal(result.records, 2);
    assert.equal(materializeCalls.length, 1);
    assert.equal(await readFile(join(destination, 'writing-a', 'SKILL.md'), 'utf8'), 'a');
    assert.equal(await readFile(join(destination, 'writing-b', 'SKILL.md'), 'utf8'), 'b');
  });

  it('makes no network calls in a dry run and reports each file', async () => {
    const lineagePath = await copyGlob();
    await writeFile(join(destination, 'writing-a', 'SKILL.md'), 'local edit');
    await unlink(join(destination, 'writing-b', 'SKILL.md'));

    const result = await restoreLineage({ lineagePath, dryRun: true, fetcher: offlineFetcher });

    assert.equal(result.status, 'dry-run');
    const byPath = Object.fromEntries(result.files.map(file => [file.path, file]));
    assert.equal(byPath['writing-a/SKILL.md'].state, 'modified');
    assert.equal(byPath['writing-a/SKILL.md'].action, 'refuse');
    assert.equal(byPath['writing-a/refs/notes.md'].state, 'unchanged');
    assert.equal(byPath['writing-b/SKILL.md'].state, 'missing');
    assert.equal(byPath['writing-b/SKILL.md'].action, 'fetch');
    assert.equal(await readFile(join(destination, 'writing-a', 'SKILL.md'), 'utf8'), 'local edit');
    assert.equal(await exists(join(destination, 'writing-b', 'SKILL.md')), false);
  });

  it('restores unpinned records from HEAD with a warning and still enforces hashes', async () => {
    const lineagePath = await writeRecord(
      destination,
      copyRecord(
        { 'SKILL.md': { sha256: sha256('a'), size: 1 } },
        'pkg:github/user/repo#skills/writing-a'
      )
    );

    const result = await restoreLineage({ lineagePath, fetcher });

    assert.match(result.warnings[0], /not pinned/);
    assert.deepEqual(materializeCalls, ['https://api.github.com/repos/user/repo/tarball']);
    assert.equal(await readFile(join(destination, 'SKILL.md'), 'utf8'), 'a');

    await unlink(join(destination, 'SKILL.md'));
    await writeFile(join(fixtureRepository, 'skills', 'writing-a', 'SKILL.md'), 'moved on');
    await assert.rejects(restoreLineage({ lineagePath, fetcher }), /no longer matches.*at HEAD/);
    assert.equal(await exists(join(destination, 'SKILL.md')), false);
  });
});
