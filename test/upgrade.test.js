import {
  describe, it, beforeEach, afterEach
} from 'node:test';
import {strict as assert} from 'node:assert';
import {
  mkdtemp, writeFile, readFile, mkdir, rm
} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseVlurpfile, updateRef, updateRefs} from '../src/vlurpfile.js';
import {buildCatalog} from '../src/catalog.js';
import {diffCatalogs, formatCatalogDiff} from '../src/catalog-diff.js';

describe('upgrade - vlurpfile rewriting', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vlurp-upgrade-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, {recursive: true, force: true});
  });

  it('should update --ref in a vlurpfile on disk', async () => {
    const vlurpfilePath = join(tempDir, '.vlurpfile');
    const original = `# Skills
vlurp garrytan/gstack -d ./skills --preset skills --ref abc1234
vlurp obra/superpowers -d ./skills --preset claude --ref def5678
`;
    await writeFile(vlurpfilePath, original);

    // Simulate what upgrade does: read, updateRefs, write
    const content = await readFile(vlurpfilePath, 'utf8');
    const updated = updateRefs(content, {
      'garrytan/gstack': 'new1111'
    });
    await writeFile(vlurpfilePath, updated);

    // Verify the file was written correctly
    const result = await readFile(vlurpfilePath, 'utf8');
    assert.ok(result.includes('--ref new1111'));
    assert.ok(result.includes('--ref def5678')); // Unchanged

    // Verify it's still parseable
    const entries = parseVlurpfile(result);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].ref, 'new1111');
    assert.equal(entries[1].ref, 'def5678');
  });

  it('should add --ref to previously unpinned entries', async () => {
    const vlurpfilePath = join(tempDir, '.vlurpfile');
    const original = `vlurp user/repo -d ./skills --preset claude
`;
    await writeFile(vlurpfilePath, original);

    const content = await readFile(vlurpfilePath, 'utf8');
    const updated = updateRef(content, 'user/repo', 'abc1234');
    await writeFile(vlurpfilePath, updated);

    const result = await readFile(vlurpfilePath, 'utf8');
    const entries = parseVlurpfile(result);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ref, 'abc1234');
    assert.equal(entries[0].preset, 'claude');
  });

  it('should handle multi-entry upgrades for same source', async () => {
    const vlurpfilePath = join(tempDir, '.vlurpfile');
    const original = `# dcramer/dex -- multiple extracts from same repo
vlurp dcramer/dex -d ./skills --filter "plugins/dex/skills/dex/**" --as dex --ref abc1234
vlurp dcramer/dex -d ./skills --filter "plugins/dex/skills/dex-plan/**" --as dex-plan --ref abc1234
`;
    await writeFile(vlurpfilePath, original);

    const content = await readFile(vlurpfilePath, 'utf8');
    const updated = updateRefs(content, {
      'dcramer/dex': 'new5678'
    });
    await writeFile(vlurpfilePath, updated);

    const result = await readFile(vlurpfilePath, 'utf8');
    const entries = parseVlurpfile(result);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].ref, 'new5678');
    assert.equal(entries[0].as, 'dex');
    assert.equal(entries[1].ref, 'new5678');
    assert.equal(entries[1].as, 'dex-plan');
  });

  it('should preserve full vlurpfile structure through upgrade cycle', async () => {
    const vlurpfilePath = join(tempDir, '.vlurpfile');
    const original = `# .vlurpfile.skills - Agent skill sources, reviewed and pinned

# gstack -- Workflow skills
vlurp garrytan/gstack -d .claude/skills --preset skills --ref abc1234

# dex -- Task management
vlurp dcramer/dex -d ./skills --filter "plugins/dex/skills/dex/**" --as dex --ref 939f6cb

# obra -- Core patterns (unpinned)
vlurp obra/superpowers -d ./skills --preset claude
`;
    await writeFile(vlurpfilePath, original);

    // Simulate upgrading all three sources
    const content = await readFile(vlurpfilePath, 'utf8');
    const updated = updateRefs(content, {
      'garrytan/gstack': 'fff1111',
      'dcramer/dex': 'fff2222',
      'obra/superpowers': 'fff3333'
    });
    await writeFile(vlurpfilePath, updated);

    const result = await readFile(vlurpfilePath, 'utf8');
    const lines = result.split('\n');

    // Verify structure preserved
    assert.equal(lines[0], '# .vlurpfile.skills - Agent skill sources, reviewed and pinned');
    assert.equal(lines[1], '');
    assert.equal(lines[2], '# gstack -- Workflow skills');
    assert.ok(lines[3].includes('--ref fff1111'));
    assert.equal(lines[4], '');
    assert.equal(lines[5], '# dex -- Task management');
    assert.ok(lines[6].includes('--ref fff2222'));
    assert.equal(lines[7], '');
    assert.equal(lines[8], '# obra -- Core patterns (unpinned)');
    assert.ok(lines[9].includes('--ref fff3333'));

    // Verify parseable and correct
    const entries = parseVlurpfile(result);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].source, 'garrytan/gstack');
    assert.equal(entries[0].ref, 'fff1111');
    assert.equal(entries[0].preset, 'skills');
    assert.equal(entries[1].source, 'dcramer/dex');
    assert.equal(entries[1].ref, 'fff2222');
    assert.equal(entries[1].as, 'dex');
    assert.equal(entries[2].source, 'obra/superpowers');
    assert.equal(entries[2].ref, 'fff3333');
    assert.equal(entries[2].preset, 'claude');
  });

  it('should not modify vlurpfile when no sources are outdated', async () => {
    const vlurpfilePath = join(tempDir, '.vlurpfile');
    const original = `vlurp user/repo -d ./skills --ref abc1234
`;
    await writeFile(vlurpfilePath, original);

    // Empty updates = no changes
    const content = await readFile(vlurpfilePath, 'utf8');
    const updated = updateRefs(content, {});

    assert.equal(updated, original);
  });
});

describe('upgrade - catalog integration', () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vlurp-catalog-int-'));
  });

  afterEach(async () => {
    await rm(tempDir, {recursive: true, force: true});
  });

  it('should build catalog from lineage and SKILL.md on disk', async () => {
    // Set up a minimal skills directory with lineage and a SKILL.md
    const skillDir = join(tempDir, 'myskill');
    await mkdir(skillDir, {recursive: true});
    await writeFile(join(skillDir, 'SKILL.md'), `---
name: myskill
version: 1.0.0
description: A test skill
allowed-tools:
  - Bash
  - Read
---

# My Skill

Use Bash tool to run commands.
`);

    // Write lineage record
    const lineageRecord = {
      source: 'github:user/repo',
      ref: 'abc1234',
      fetched_at: '2026-03-15T00:00:00Z', // eslint-disable-line camelcase
      filters: [],
      preset: null,
      as: 'myskill',
      files: {
        'SKILL.md': {sha256: 'fake', size: 100}
      }
    };
    await writeFile(join(tempDir, '.vlurp.jsonl'), JSON.stringify(lineageRecord) + '\n');

    const catalog = await buildCatalog(tempDir);
    assert.ok(catalog.skills.myskill);
    assert.equal(catalog.skills.myskill.version, '1.0.0');
    assert.equal(catalog.skills.myskill.ref, 'abc1234');
    assert.equal(catalog.skills.myskill.source, 'github:user/repo');
    assert.ok(catalog.generated_at);
  });

  it('should diff catalogs from pre/post upgrade snapshots', async () => {
    // Simulate pre-upgrade catalog
    const preCatalog = {
      skills: {
        myskill: {
          source: 'github:user/repo',
          ref: 'old123',
          version: '1.0.0',
          tool_surface: ['Bash'], // eslint-disable-line camelcase
          command_surface: [], // eslint-disable-line camelcase
          supporting_files: [] // eslint-disable-line camelcase
        }
      }
    };

    // Simulate post-upgrade catalog
    const postCatalog = {
      skills: {
        myskill: {
          source: 'github:user/repo',
          ref: 'new456',
          version: '1.1.0',
          tool_surface: ['Bash', 'Read'], // eslint-disable-line camelcase
          command_surface: [], // eslint-disable-line camelcase
          supporting_files: ['helper.md'] // eslint-disable-line camelcase
        }
      }
    };

    const diff = diffCatalogs(preCatalog, postCatalog);
    assert.equal(diff.skills.myskill.status, 'changed');
    assert.deepEqual(diff.skills.myskill.version, {old: '1.0.0', new: '1.1.0'});
    assert.deepEqual(diff.skills.myskill.tool_surface.added, ['Read']);
    assert.deepEqual(diff.skills.myskill.supporting_files.added, ['helper.md']);

    // Verify formatted output
    const output = formatCatalogDiff(diff);
    assert.ok(output.includes('1.0.0 -> 1.1.0'));
    assert.ok(output.includes('+Read'));
    assert.ok(output.includes('+helper.md'));
    assert.ok(output.includes('1 changed'));
  });

  it('should write catalog.json and catalog.prev.json', async () => {
    // Write an existing catalog.json
    const existingCatalog = {generated_at: '2026-03-14T00:00:00Z', skills: {}}; // eslint-disable-line camelcase
    await writeFile(join(tempDir, 'catalog.json'), JSON.stringify(existingCatalog, null, 2) + '\n');

    // Simulate the saveCatalogs pattern from upgrade
    const {rename: fsRename} = await import('node:fs/promises');
    const catalogPath = join(tempDir, 'catalog.json');
    const prevPath = join(tempDir, 'catalog.prev.json');

    // Rotate
    await fsRename(catalogPath, prevPath);

    // Write new
    const newCatalog = {generated_at: '2026-03-15T00:00:00Z', skills: {a: {version: '1.0.0'}}}; // eslint-disable-line camelcase
    await writeFile(catalogPath, JSON.stringify(newCatalog, null, 2) + '\n');

    // Verify both files exist
    const prev = JSON.parse(await readFile(prevPath, 'utf8'));
    const current = JSON.parse(await readFile(catalogPath, 'utf8'));

    assert.equal(prev.generated_at, '2026-03-14T00:00:00Z');
    assert.equal(current.generated_at, '2026-03-15T00:00:00Z');
    assert.ok(current.skills.a);
  });
});
