import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binPath = join(__dirname, '..', 'bin', 'vlurp');

describe('CLI', () => {
  it('should show help with --help', () => {
    const output = execSync(`node ${binPath} --help`, { encoding: 'utf8' });
    assert.ok(output.includes('vlurp'), 'Help should mention vlurp');
    assert.ok(output.includes('--help'), 'Help should show --help option');
    assert.ok(output.includes('SOURCE... DEST'), 'Help should describe cp-style operands');
    assert.ok(output.includes('pkg:github/'), 'Help should describe PURL sources');
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

  it('rejects legacy selection flags with PURL operands', () => {
    assert.throws(
      () =>
        execSync(`node ${binPath} pkg:github/user/repo#docs ./docs --filter '*.md'`, {
          encoding: 'utf8',
          stdio: 'pipe'
        }),
      error => error.status !== 0 && error.stderr.includes('cannot be used with PURL sources')
    );
  });
});
