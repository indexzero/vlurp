import { strict as assert } from 'node:assert';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  appendLineage,
  createLineageRecord,
  hashDirectory,
  hashFile,
  readLineage,
  verifyFiles
} from '../src/lineage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures', 'lineage-test');

describe('lineage', () => {
  beforeEach(async () => {
    await mkdir(fixturesDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(fixturesDir, { recursive: true, force: true });
  });

  describe('hashFile', () => {
    it('should compute SHA-256 hash and size', async () => {
      const filePath = join(fixturesDir, 'test.txt');
      await writeFile(filePath, 'hello world');

      const result = await hashFile(filePath);
      assert.equal(typeof result.sha256, 'string');
      assert.equal(result.sha256.length, 64);
      assert.equal(result.size, 11);
    });

    it('should produce consistent hashes for same content', async () => {
      const file1 = join(fixturesDir, 'a.txt');
      const file2 = join(fixturesDir, 'b.txt');
      await writeFile(file1, 'same content');
      await writeFile(file2, 'same content');

      const hash1 = await hashFile(file1);
      const hash2 = await hashFile(file2);
      assert.equal(hash1.sha256, hash2.sha256);
    });

    it('should produce different hashes for different content', async () => {
      const file1 = join(fixturesDir, 'a.txt');
      const file2 = join(fixturesDir, 'b.txt');
      await writeFile(file1, 'content a');
      await writeFile(file2, 'content b');

      const hash1 = await hashFile(file1);
      const hash2 = await hashFile(file2);
      assert.notEqual(hash1.sha256, hash2.sha256);
    });
  });

  describe('hashDirectory', () => {
    it('should hash all files recursively', async () => {
      await mkdir(join(fixturesDir, 'sub'), { recursive: true });
      await writeFile(join(fixturesDir, 'root.md'), '# Root');
      await writeFile(join(fixturesDir, 'sub', 'nested.md'), '# Nested');

      const result = await hashDirectory(fixturesDir);
      assert.ok(result['root.md']);
      assert.ok(result['sub/nested.md']);
      assert.equal(Object.keys(result).length, 2);
      assert.equal(typeof result['root.md'].sha256, 'string');
      assert.equal(typeof result['root.md'].size, 'number');
    });
  });

  describe('createLineageRecord', () => {
    it('should create a well-formed record', () => {
      const record = createLineageRecord({
        source: 'dcramer/dex',
        ref: '939f6cb',
        refType: 'commit',
        filters: ['skills/**'],
        preset: 'skills',
        asName: 'dex',
        files: {
          'SKILL.md': { sha256: 'abc123', size: 100 }
        }
      });

      assert.equal(record.source, 'github:dcramer/dex');
      assert.equal(record.ref, '939f6cb');
      assert.equal(record.ref_type, 'commit');
      assert.ok(record.fetched_at);
      assert.deepEqual(record.filters, ['skills/**']);
      assert.equal(record.preset, 'skills');
      assert.equal(record.as, 'dex');
      assert.deepEqual(record.files, { 'SKILL.md': { sha256: 'abc123', size: 100 } });
    });

    it('should handle unpinned fetches', () => {
      const record = createLineageRecord({
        source: 'user/repo',
        files: {}
      });

      assert.equal(record.ref, null);
      assert.equal(record.ref_type, null);
      assert.equal(record.preset, null);
      assert.equal(record.as, null);
    });
  });

  describe('appendLineage / readLineage', () => {
    it('should write and read JSONL records', async () => {
      const jsonlPath = join(fixturesDir, '.vlurp.jsonl');

      const record1 = createLineageRecord({
        source: 'user/repo1',
        ref: 'abc1234',
        files: { 'a.md': { sha256: 'hash1', size: 10 } }
      });

      const record2 = createLineageRecord({
        source: 'user/repo2',
        ref: 'def5678',
        files: { 'b.md': { sha256: 'hash2', size: 20 } }
      });

      await appendLineage(jsonlPath, record1);
      await appendLineage(jsonlPath, record2);

      const records = await readLineage(jsonlPath);
      assert.equal(records.length, 2);
      assert.equal(records[0].source, 'github:user/repo1');
      assert.equal(records[1].source, 'github:user/repo2');
    });

    it('should replace records for the same source+as key', async () => {
      const jsonlPath = join(fixturesDir, '.vlurp.jsonl');

      const record1 = createLineageRecord({
        source: 'user/repo',
        ref: 'old',
        files: { 'a.md': { sha256: 'old-hash', size: 10 } }
      });

      await appendLineage(jsonlPath, record1);

      const record2 = createLineageRecord({
        source: 'user/repo',
        ref: 'new',
        files: { 'a.md': { sha256: 'new-hash', size: 15 } }
      });

      await appendLineage(jsonlPath, record2);

      const records = await readLineage(jsonlPath);
      assert.equal(records.length, 1);
      assert.equal(records[0].ref, 'new');
    });

    it('should keep separate records for different --as values', async () => {
      const jsonlPath = join(fixturesDir, '.vlurp.jsonl');

      const record1 = createLineageRecord({
        source: 'user/repo',
        asName: 'skill-a',
        files: { 'a.md': { sha256: 'hash1', size: 10 } }
      });

      const record2 = createLineageRecord({
        source: 'user/repo',
        asName: 'skill-b',
        files: { 'b.md': { sha256: 'hash2', size: 20 } }
      });

      await appendLineage(jsonlPath, record1);
      await appendLineage(jsonlPath, record2);

      const records = await readLineage(jsonlPath);
      assert.equal(records.length, 2);
    });

    it('should return empty array for missing file', async () => {
      const records = await readLineage(join(fixturesDir, 'nonexistent.jsonl'));
      assert.deepEqual(records, []);
    });
  });

  describe('verifyFiles', () => {
    it('should report ok for unmodified files with --as', async () => {
      // Simulate: vlurp user/repo --as myskill -d ./content
      // Files at content/myskill/SKILL.md, JSONL at content/.vlurp.jsonl
      const contentDir = join(fixturesDir, 'content');
      await mkdir(join(contentDir, 'myskill'), { recursive: true });
      await writeFile(join(contentDir, 'myskill', 'SKILL.md'), '# My Skill');

      const { sha256, size } = await hashFile(join(contentDir, 'myskill', 'SKILL.md'));
      const records = [
        {
          source: 'github:user/repo',
          ref: 'abc1234',
          as: 'myskill',
          files: { 'SKILL.md': { sha256, size } }
        }
      ];

      const results = await verifyFiles(contentDir, records);
      const skillResult = results.find(r => r.file === 'myskill/SKILL.md');
      assert.equal(skillResult.status, 'ok');
    });

    it('should report ok for unmodified files without --as', async () => {
      // Simulate: vlurp user/repo -d ./content
      // Files at content/user/repo/SKILL.md, JSONL at content/.vlurp.jsonl
      const contentDir = join(fixturesDir, 'content');
      await mkdir(join(contentDir, 'user', 'repo'), { recursive: true });
      await writeFile(join(contentDir, 'user', 'repo', 'SKILL.md'), '# My Skill');

      const { sha256, size } = await hashFile(join(contentDir, 'user', 'repo', 'SKILL.md'));
      const records = [
        {
          source: 'github:user/repo',
          ref: 'abc1234',
          as: null,
          files: { 'SKILL.md': { sha256, size } }
        }
      ];

      const results = await verifyFiles(contentDir, records);
      const skillResult = results.find(r => r.file === 'user/repo/SKILL.md');
      assert.equal(skillResult.status, 'ok');
    });

    it('should detect modified files', async () => {
      const contentDir = join(fixturesDir, 'content');
      await mkdir(join(contentDir, 'dex'), { recursive: true });
      await writeFile(join(contentDir, 'dex', 'SKILL.md'), '# My Skill');

      const records = [
        {
          source: 'github:user/repo',
          ref: 'abc1234',
          as: 'dex',
          files: { 'SKILL.md': { sha256: 'wrong-hash', size: 100 } }
        }
      ];

      const results = await verifyFiles(contentDir, records);
      const skillResult = results.find(r => r.file === 'dex/SKILL.md');
      assert.equal(skillResult.status, 'modified');
    });

    it('should detect missing files', async () => {
      const contentDir = join(fixturesDir, 'content');
      await mkdir(join(contentDir, 'dex'), { recursive: true });

      const records = [
        {
          source: 'github:user/repo',
          ref: 'abc1234',
          as: 'dex',
          files: { 'MISSING.md': { sha256: 'some-hash', size: 100 } }
        }
      ];

      const results = await verifyFiles(contentDir, records);
      const missingResult = results.find(r => r.file === 'dex/MISSING.md');
      assert.equal(missingResult.status, 'missing');
    });

    it('should detect untracked files', async () => {
      const contentDir = join(fixturesDir, 'content');
      await mkdir(join(contentDir, 'myskill'), { recursive: true });
      await writeFile(join(contentDir, 'myskill', 'tracked.md'), '# Tracked');
      await writeFile(join(contentDir, 'myskill', 'untracked.md'), '# Untracked');

      const { sha256, size } = await hashFile(join(contentDir, 'myskill', 'tracked.md'));
      const records = [
        {
          source: 'github:user/repo',
          ref: 'abc1234',
          as: 'myskill',
          files: { 'tracked.md': { sha256, size } }
        }
      ];

      const results = await verifyFiles(contentDir, records);
      const trackedResult = results.find(r => r.file === 'myskill/tracked.md');
      const untrackedResult = results.find(r => r.file === 'myskill/untracked.md');
      assert.equal(trackedResult.status, 'ok');
      assert.equal(untrackedResult.status, 'untracked');
    });

    it('should skip .vlurp.jsonl in untracked results', async () => {
      const contentDir = join(fixturesDir, 'content');
      await mkdir(join(contentDir, 'myskill'), { recursive: true });
      await writeFile(join(contentDir, '.vlurp.jsonl'), '{}');
      await writeFile(join(contentDir, 'myskill', 'tracked.md'), '# Tracked');

      const { sha256, size } = await hashFile(join(contentDir, 'myskill', 'tracked.md'));
      const records = [
        {
          source: 'github:user/repo',
          ref: 'abc1234',
          as: 'myskill',
          files: { 'tracked.md': { sha256, size } }
        }
      ];

      const results = await verifyFiles(contentDir, records);
      const jsonlResult = results.find(r => r.file === '.vlurp.jsonl');
      assert.equal(jsonlResult, undefined);
    });
  });
});
