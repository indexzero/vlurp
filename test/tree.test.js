import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {join, dirname} from 'node:path';
import {mkdir, writeFile, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {buildTreeString} from '../src/tree.js';

describe('Tree display', () => {
  it('should include hidden directories in tree output', async () => {
    // Use test/fixtures instead of os.tmpdir for safety
    const testFixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
    const testDir = join(testFixturesDir, 'tree-test');

    try {
      // Ensure fixtures directory exists
      await mkdir(testFixturesDir, {recursive: true});
      // Create test directory structure
      await mkdir(testDir, {recursive: true});
      await mkdir(join(testDir, '.claude'), {recursive: true});
      await mkdir(join(testDir, 'visible-dir'), {recursive: true});
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
      await rm(testDir, {recursive: true, force: true});
    }
  });
});
