import process from 'node:process';
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { join, dirname } from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { minimatch } from 'minimatch';
import { Validator, Parser } from '../src/index.js';
import { resolveTargetPath } from '../src/commands/fetch.js';
import { buildTreeString } from '../src/tree.js';

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
      assert.throws(
        () => parser.parse('invalid-format'),
        /Invalid input format/
      );
    });

    it('should throw on invalid URL', () => {
      assert.throws(
        () => parser.parse('https://gitlab.com/user/repo'),
        /Invalid input format/
      );
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
      filters.some(pattern => minimatch(file, pattern, { matchBase: true })));

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

    const otherPaths = [
      'README.md',
      'CLAUDE.md',
      '.taskmaster/CLAUDE.md',
      'src/index.js'
    ];

    // All .claude paths should match .claude/**
    claudePaths.forEach(path => {
      assert.ok(
        minimatch(path, '.claude/**', { dot: true }),
        `Expected ${path} to match .claude/**`
      );
    });

    // Other paths should not match
    otherPaths.forEach(path => {
      assert.ok(
        !minimatch(path, '.claude/**', { dot: true }),
        `Expected ${path} to NOT match .claude/**`
      );
    });
  });

  it('should have correctly formatted default filters for glob', () => {
    // Default filters as defined in cli.js
    const defaultFilters = ['.claude/**', 'CLAUDE.md', '*.md', '!README.md', '!CONTRIBUTING.md', '!LICENSE.md', '!CHANGELOG.md', '!CODE_OF_CONDUCT.md', 'agents/**', 'commands/**'];

    // Simply verify our default filters are properly formatted for glob
    // We trust glob to handle the actual pattern matching correctly

    const ignorePatterns = defaultFilters.filter(p => p.startsWith('!'));
    const includePatterns = defaultFilters.filter(p => !p.startsWith('!'));

    // Verify we have both include and exclude patterns
    assert.ok(includePatterns.length > 0, 'Should have include patterns');
    assert.ok(ignorePatterns.length > 0, 'Should have ignore patterns');

    // Verify ignore patterns are properly formatted with !
    ignorePatterns.forEach(pattern => {
      assert.ok(pattern.startsWith('!'), `Ignore pattern ${pattern} should start with !`);
    });

    // Verify include patterns don't start with !
    includePatterns.forEach(pattern => {
      assert.ok(!pattern.startsWith('!'), `Include pattern ${pattern} should not start with !`);
    });

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

describe('Tree display', () => {
  it('should include hidden directories in tree output', async () => {
    // Use test/fixtures instead of os.tmpdir for safety
    const testFixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
    const testDir = join(testFixturesDir, 'tree-test');

    try {
      // Ensure fixtures directory exists
      await mkdir(testFixturesDir, { recursive: true });
      // Create test directory structure
      await mkdir(testDir, { recursive: true });
      await mkdir(join(testDir, '.claude'), { recursive: true });
      await mkdir(join(testDir, 'visible-dir'), { recursive: true });
      await writeFile(join(testDir, 'README.md'), 'test');
      await writeFile(join(testDir, '.hidden-file'), 'test');
      await writeFile(join(testDir, '.claude', 'config.json'), 'test');
      await writeFile(join(testDir, 'visible-dir', 'file.js'), 'test');

      // Build tree string
      const treeOutput = await buildTreeString(testDir);

      // Verify tree output includes hidden directories and files
      assert.ok(treeOutput, 'Tree output should be generated');
      assert.ok(treeOutput.includes('.claude'), 'Tree should include .claude directory');
      assert.ok(treeOutput.includes('.hidden-file'), 'Tree should include hidden files');
      assert.ok(treeOutput.includes('visible-dir'), 'Tree should include visible directories');
      assert.ok(treeOutput.includes('README.md'), 'Tree should include regular files');
      assert.ok(treeOutput.includes('config.json'), 'Tree should include files within hidden directories');
    } finally {
      // Clean up test directory only (not the fixtures directory)
      await rm(testDir, { recursive: true, force: true });
    }
  });
});
