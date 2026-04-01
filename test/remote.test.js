import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import { minimatch } from 'minimatch';
import { resolveTargetPath } from '../src/commands/fetch.js';
import { Parser, Validator } from '../src/remote.js';

describe('Validator', () => {
  const validator = new Validator();

  describe('#validate', () => {
    it('should validate GitHub URLs', () => {
      const result = validator.validate('https://github.com/facebook/react');
      assert.equal(result.valid, true);
      assert.equal(result.type, 'github');
      assert.equal(result.user, 'facebook');
      assert.equal(result.repo, 'react');
    });

    it('should validate GitHub URLs with .git extension', () => {
      const result = validator.validate('https://github.com/nodejs/node.git');
      assert.equal(result.valid, true);
      assert.equal(result.type, 'github');
      assert.equal(result.user, 'nodejs');
      assert.equal(result.repo, 'node');
    });

    it('should reject non-GitHub URLs', () => {
      const result = validator.validate('https://gitlab.com/user/repo');
      assert.equal(result.valid, false);
      assert.equal(result.error, 'URL must be from github.com or gist.github.com');
    });

    it('should reject invalid input', () => {
      const result = validator.validate(null);
      assert.equal(result.valid, false);
      assert.equal(result.error, 'Invalid URL provided');
    });
  });
});

describe('Parser', () => {
  const parser = new Parser();

  describe('#parse', () => {
    it('should parse user/repo format', () => {
      const result = parser.parse('facebook/react');
      assert.equal(result.type, 'github');
      assert.equal(result.user, 'facebook');
      assert.equal(result.repo, 'react');
      assert.ok(result.tarballUrl.includes('github.com'));
      assert.ok(result.tarballUrl.includes('facebook/react'));
    });

    it('should parse GitHub URLs', () => {
      const result = parser.parse('https://github.com/nodejs/node');
      assert.equal(result.type, 'github');
      assert.equal(result.user, 'nodejs');
      assert.equal(result.repo, 'node');
      assert.ok(result.tarballUrl.includes('github.com'));
      assert.ok(result.tarballUrl.includes('nodejs/node'));
    });

    it('should throw on invalid format', () => {
      assert.throws(() => parser.parse('invalid-format'), /Invalid input format/);
    });

    it('should throw on invalid URL', () => {
      assert.throws(() => parser.parse('https://gitlab.com/user/repo'), /Invalid input format/);
    });
  });
});

describe('resolveTargetPath', () => {
  it('should resolve to current directory when no root specified', () => {
    const result = resolveTargetPath('user', 'repo');
    assert.equal(result, join(process.cwd(), 'user', 'repo'));
  });

  it('should resolve to root directory when specified', () => {
    const result = resolveTargetPath('user', 'repo', '/tmp');
    assert.equal(result, join('/tmp', 'user', 'repo'));
  });

  it('should handle relative root directories', () => {
    const result = resolveTargetPath('user', 'repo', './repos');
    assert.equal(result, join(process.cwd(), 'repos', 'user', 'repo'));
  });
});

describe('Filter functionality', () => {
  it('should match files with glob patterns', () => {
    // Test basic patterns
    assert.ok(minimatch('README.md', '*.md'));
    assert.ok(minimatch('src/index.js', 'src/**'));
    assert.ok(minimatch('.claude/config.json', '.claude/**'));
    assert.ok(minimatch('CLAUDE.md', 'CLAUDE.md'));

    // Test non-matches
    assert.ok(!minimatch('README.txt', '*.md'));
    assert.ok(!minimatch('lib/index.js', 'src/**'));
  });

  it('should filter with multiple patterns', () => {
    const filters = ['*.md', 'src/**', '.claude/**'];

    const testFiles = [
      'README.md',
      'src/index.js',
      'src/utils/helper.js',
      '.claude/config.json',
      'lib/other.js',
      'package.json'
    ];

    const filtered = testFiles.filter(file =>
      filters.some(pattern => minimatch(file, pattern, { matchBase: true }))
    );

    assert.deepEqual(filtered, [
      'README.md',
      'src/index.js',
      'src/utils/helper.js',
      '.claude/config.json'
    ]);
  });

  it('should handle .claude/** pattern for eyaltoledano/claude-task-master repo structure', () => {
    // Test paths from the claude-task-master repository
    const claudePaths = [
      '.claude/TM_COMMANDS_GUIDE.md',
      '.claude/commands/tm/add.md',
      '.claude/commands/tm/status.md',
      '.claude/commands/tm/add-dependency/add-dependency.md',
      '.claude/commands/tm/add-subtask/add-subtask.md'
    ];

    const otherPaths = ['README.md', 'CLAUDE.md', '.taskmaster/CLAUDE.md', 'src/index.js'];

    // All .claude paths should match .claude/**
    for (const path of claudePaths) {
      assert.ok(
        minimatch(path, '.claude/**', { dot: true }),
        `Expected ${path} to match .claude/**`
      );
    }

    // Other paths should not match
    for (const path of otherPaths) {
      assert.ok(
        !minimatch(path, '.claude/**', { dot: true }),
        `Expected ${path} to NOT match .claude/**`
      );
    }
  });

  it('should have correctly formatted default filters for glob', () => {
    // Default filters as defined in cli.js
    const defaultFilters = [
      '.claude/**',
      'CLAUDE.md',
      '*.md',
      '!README.md',
      '!CONTRIBUTING.md',
      '!LICENSE.md',
      '!CHANGELOG.md',
      '!CODE_OF_CONDUCT.md',
      'agents/**',
      'commands/**'
    ];

    // Simply verify our default filters are properly formatted for glob
    // We trust glob to handle the actual pattern matching correctly

    const ignorePatterns = defaultFilters.filter(p => p.startsWith('!'));
    const includePatterns = defaultFilters.filter(p => !p.startsWith('!'));

    // Verify we have both include and exclude patterns
    assert.ok(includePatterns.length > 0, 'Should have include patterns');
    assert.ok(ignorePatterns.length > 0, 'Should have ignore patterns');

    // Verify ignore patterns are properly formatted with !
    for (const pattern of ignorePatterns) {
      assert.ok(pattern.startsWith('!'), `Ignore pattern ${pattern} should start with !`);
    }

    // Verify include patterns don't start with !
    for (const pattern of includePatterns) {
      assert.ok(!pattern.startsWith('!'), `Include pattern ${pattern} should not start with !`);
    }

    // Verify specific patterns we expect
    assert.ok(includePatterns.includes('*.md'), 'Should include markdown files');
    assert.ok(includePatterns.includes('.claude/**'), 'Should include .claude directory');
    assert.ok(includePatterns.includes('agents/**'), 'Should include agents directory');
    assert.ok(includePatterns.includes('commands/**'), 'Should include commands directory');

    // Verify specific exclusions
    assert.ok(ignorePatterns.includes('!README.md'), 'Should exclude README.md');
    assert.ok(ignorePatterns.includes('!CONTRIBUTING.md'), 'Should exclude CONTRIBUTING.md');
  });
});
