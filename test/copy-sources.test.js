import { strict as assert } from 'node:assert';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { copySources } from '../src/copy-sources.js';
import { readLineage, verifyFiles } from '../src/lineage.js';

describe('copySources', () => {
  let temporaryDirectory;
  let fixtureRepository;
  let destination;
  let fetcher;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'vlurp-copy-sources-'));
    fixtureRepository = join(temporaryDirectory, 'fixture');
    destination = join(temporaryDirectory, 'skills');
    await mkdir(join(fixtureRepository, 'skills', 'writing-a'), { recursive: true });
    await mkdir(join(fixtureRepository, 'skills', 'writing-b'), { recursive: true });
    await mkdir(destination);
    await writeFile(join(fixtureRepository, 'skills', 'writing-a', 'SKILL.md'), 'a');
    await writeFile(join(fixtureRepository, 'skills', 'writing-b', 'SKILL.md'), 'b');
    await writeFile(join(fixtureRepository, 'README.md'), 'boilerplate');

    fetcher = {
      async materialize() {
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

  it('copies glob matches with basename semantics and records verifiable lineage', async () => {
    const result = await copySources({
      sources: ['pkg:github/user/repo@abc1234#skills/writing-*'],
      destination,
      force: true,
      fetcher
    });

    assert.equal(result.status, 'complete');
    assert.equal(result.fileCount, 2);
    assert.equal(await readFile(join(destination, 'writing-a', 'SKILL.md'), 'utf8'), 'a');
    assert.equal(await readFile(join(destination, 'writing-b', 'SKILL.md'), 'utf8'), 'b');

    const records = await readLineage(join(destination, '.vlurp.jsonl'));
    assert.equal(records.length, 1);
    assert.equal(records[0].source, 'pkg:github/user/repo@abc1234#skills/writing-*');
    assert.deepEqual(Object.keys(records[0].files), ['writing-a/SKILL.md', 'writing-b/SKILL.md']);
    const verification = await verifyFiles(destination, records);
    assert.equal(verification.filter(result => result.status !== 'ok').length, 0);
  });

  it('does not write when an overwrite is declined', async () => {
    await mkdir(join(destination, 'writing-a'));
    await writeFile(join(destination, 'writing-a', 'SKILL.md'), 'local');

    const result = await copySources({
      sources: ['pkg:github/user/repo#skills/writing-a'],
      destination,
      fetcher,
      confirm: async () => false
    });

    assert.equal(result.status, 'cancelled');
    assert.equal(await readFile(join(destination, 'writing-a', 'SKILL.md'), 'utf8'), 'local');
  });

  it('expands presets into transfer rules for PURL cp sources', async () => {
    await writeFile(join(fixtureRepository, 'skills', 'writing-a', 'script.js'), 'ignored');
    await copySources({
      sources: ['pkg:github/user/repo#skills/writing-a'],
      destination,
      preset: 'skills',
      force: true,
      fetcher
    });

    assert.equal(await readFile(join(destination, 'writing-a', 'SKILL.md'), 'utf8'), 'a');
    await assert.rejects(readFile(join(destination, 'writing-a', 'script.js')), /ENOENT/);
  });

  it('places lineage inside a newly named directory copy', async () => {
    const namedDestination = join(temporaryDirectory, 'named-skill');
    await copySources({
      sources: ['pkg:github/user/repo#skills/writing-a'],
      destination: namedDestination,
      force: true,
      fetcher
    });

    const records = await readLineage(join(namedDestination, '.vlurp.jsonl'));
    assert.equal(records.length, 1);
    assert.deepEqual(Object.keys(records[0].files), ['SKILL.md']);
    const verification = await verifyFiles(namedDestination, records);
    assert.equal(verification.filter(result => result.status !== 'ok').length, 0);
  });

  it('reuses one materialization for selectors from the same repository and ref', async () => {
    let calls = 0;
    const countingFetcher = {
      async materialize(...args) {
        calls++;
        return fetcher.materialize(...args);
      }
    };

    await copySources({
      sources: [
        'pkg:github/user/repo@abc#skills/writing-a',
        'pkg:github/user/repo@abc#skills/writing-b'
      ],
      destination,
      force: true,
      fetcher: countingFetcher
    });

    assert.equal(calls, 1);
  });
});
