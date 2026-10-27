import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
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
});
