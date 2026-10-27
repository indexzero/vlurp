import { strict as assert } from 'node:assert';
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binPath = join(__dirname, '..', 'bin', 'vlurp');
const { version } = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

describe('CLI', () => {
  for (const flag of ['-v', '--version']) {
    it(`should print the package version with ${flag}`, () => {
      // execSync throws on a non-zero exit, so returning output implies exit 0
      const output = execSync(`node ${binPath} ${flag}`, { encoding: 'utf8', stdio: 'pipe' });
      assert.equal(output.trim(), version, `${flag} should print the package.json version`);
    });
  }

  it('should show help with --help', () => {
    const output = execSync(`node ${binPath} --help`, { encoding: 'utf8' });
    assert.ok(output.includes('vlurp'), 'Help should mention vlurp');
    assert.ok(output.includes('--help'), 'Help should show --help option');
    assert.ok(output.includes('SOURCE... DEST'), 'Help should describe cp-style operands');
    assert.ok(output.includes('pkg:github/'), 'Help should describe PURL sources');
    assert.ok(output.includes('Presets:'), 'Help should keep presets as a first-class mode');
    assert.ok(output.includes('--preset'), 'Help should document the preset option');
    assert.ok(output.includes('--glob'), 'Help should document case-sensitive transfer patterns');
    assert.ok(
      output.includes('--iglob'),
      'Help should document case-insensitive transfer patterns'
    );
    assert.ok(
      output.indexOf('vlurp <owner>/<repository>') < output.indexOf("vlurp 'pkg:github/"),
      'Help should present repository shorthand before precise PURL copies'
    );
  });

  it('should show usage when called without arguments', () => {
    try {
      execSync(`node ${binPath}`, { encoding: 'utf8', stdio: 'pipe' });
      assert.fail('Should have exited with error');
    } catch (err) {
      // Expected to fail - no source provided
      assert.ok(err.status !== 0, 'Should exit with non-zero status');
    }
  });

  it('requires a destination for a PURL source', () => {
    assert.throws(
      () => execSync(`node ${binPath} pkg:github/user/repo`, { encoding: 'utf8', stdio: 'pipe' }),
      error => error.status !== 0 && error.stderr.includes('requires SOURCE and DEST')
    );
  });

  it('keeps repository selection flags separate from PURL operands', () => {
    assert.throws(
      () =>
        execSync(`node ${binPath} pkg:github/user/repo#docs ./docs --filter '*.md'`, {
          encoding: 'utf8',
          stdio: 'pipe'
        }),
      error => error.status !== 0 && error.stderr.includes('cannot be used with PURL sources')
    );
  });

  it('rejects an unknown preset before resolving a remote source', () => {
    assert.throws(
      () =>
        execSync(`node ${binPath} pkg:github/user/repo ./dest --preset made-up`, {
          encoding: 'utf8',
          stdio: 'pipe'
        }),
      error => error.status !== 0 && error.stderr.includes('unknown preset')
    );
  });

  it('leads with local file operands and documents batch as an alias', () => {
    const output = execSync(`node ${binPath} --help`, { encoding: 'utf8' });
    assert.ok(output.includes('vlurp ./path/.vlurpfile'));
    assert.ok(output.includes('vlurp ./path/.vlurp.jsonl'));
    assert.match(output, /vlurp batch <file>\s+Alias for vlurp <file>/);
  });
});

describe('CLI local file operands', () => {
  let workspace;
  let lineageContent;

  const sha256 = content => createHash('sha256').update(content).digest('hex');

  function runVlurp(args) {
    try {
      const stdout = execFileSync(process.execPath, [binPath, ...args], {
        cwd: workspace,
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, CI: '1', NO_COLOR: '1' }
      });
      return { status: 0, stdout, stderr: '' };
    } catch (error) {
      return { status: error.status, stdout: error.stdout, stderr: error.stderr };
    }
  }

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'vlurp-cli-local-'));
    await mkdir(join(workspace, 'x'));
    await writeFile(join(workspace, 'x', 'present.md'), 'present');
    lineageContent = `${JSON.stringify({
      schema: 2,
      source: 'pkg:github/user/repo@abc1234#docs',
      lineage_key: 'github:user/repo#docs',
      ref: 'abc1234',
      ref_type: 'git',
      fetched_at: '2026-10-26T00:00:00.000Z',
      destination: '.',
      globs: [],
      iglobs: [],
      preset: null,
      files_root_relative: true,
      files: {
        'present.md': { sha256: sha256('present'), size: 7 },
        'missing.md': { sha256: sha256('missing'), size: 7 }
      }
    })}\n`;
    await writeFile(join(workspace, 'x', '.vlurp.jsonl'), lineageContent);
    await writeFile(
      join(workspace, 'x', '.vlurpfile'),
      "# comments come first\nvlurp 'pkg:github/user/repo@abc1234#docs' ./docs/\n"
    );
  });

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('runs a .vlurpfile operand as a batch', () => {
    const result = runVlurp(['./x/.vlurpfile', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Dry run - would process 1 entries/);
    assert.match(result.stdout, /pkg:github\/user\/repo@abc1234#docs/);
  });

  it('restores from a .vlurp.jsonl operand', async () => {
    const result = runVlurp(['./x/.vlurp.jsonl', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Dry run - restore 2 file\(s\)/);
    assert.match(result.stdout, /fetch\s+missing\.md \(missing\)/);
    assert.match(result.stdout, /unchanged\s+present\.md/);
    assert.equal(await readFile(join(workspace, 'x', '.vlurp.jsonl'), 'utf8'), lineageContent);
  });

  it('routes batch by content so batch .vlurp.jsonl restores', () => {
    const result = runVlurp(['batch', './x/.vlurp.jsonl', '--dry-run']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Dry run - restore 2 file\(s\)/);
    assert.doesNotMatch(result.stdout, /paths\[1\]/);
  });

  it('exits non-zero when a dry run finds a locally modified file', async () => {
    await writeFile(join(workspace, 'x', 'present.md'), 'edited');
    const result = runVlurp(['./x/.vlurp.jsonl', '--dry-run']);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /modified\s+present\.md \(refused without --force\)/);
  });

  it('reports unchanged files without network access', async () => {
    await writeFile(join(workspace, 'x', 'missing.md'), 'missing');
    const result = runVlurp(['./x/.vlurp.jsonl']);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /All 2 recorded file\(s\) unchanged/);
  });

  it('rejects directories and repository flags with clear errors', () => {
    const directory = runVlurp(['./x']);
    assert.notEqual(directory.status, 0);
    assert.match(directory.stderr, /is a directory/);

    const flagged = runVlurp(['./x/.vlurp.jsonl', '--ref', 'abc1234']);
    assert.notEqual(flagged.status, 0);
    assert.match(flagged.stderr, /--ref cannot be used when restoring/);

    const missing = runVlurp(['./x/nope.jsonl']);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /No such file/);
  });
});
