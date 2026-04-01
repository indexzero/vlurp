import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { diffCatalogs, formatCatalogDiff } from '../src/catalog-diff.js';

function skill(overrides = {}) {
  return {
    source: 'github:garrytan/gstack',
    ref: 'abc1234',
    version: '1.0.0',
    tool_surface: ['Bash'],
    command_surface: [],
    supporting_files: [],
    ...overrides
  };
}

describe('diffCatalogs', () => {
  it('should detect new skills', () => {
    const oldCatalog = { skills: {} };
    const newCatalog = {
      skills: {
        browse: skill({
          tool_surface: ['Bash', 'Read'],
          command_surface: ['browse']
        })
      }
    };

    const diff = diffCatalogs(oldCatalog, newCatalog);
    assert.equal(diff.skills.browse.status, 'new');
    assert.deepEqual(diff.skills.browse.version, { old: null, new: '1.0.0' });
    assert.deepEqual(diff.skills.browse.tool_surface.added, ['Bash', 'Read']);
    assert.deepEqual(diff.skills.browse.tool_surface.removed, []);
    assert.equal(diff.summary.new, 1);
    assert.equal(diff.summary.total, 1);
  });

  it('should detect removed skills', () => {
    const oldCatalog = {
      skills: {
        'old-skill': skill({
          supporting_files: ['helper.md']
        })
      }
    };
    const newCatalog = { skills: {} };

    const diff = diffCatalogs(oldCatalog, newCatalog);
    assert.equal(diff.skills['old-skill'].status, 'removed');
    assert.deepEqual(diff.skills['old-skill'].version, { old: '1.0.0', new: null });
    assert.deepEqual(diff.skills['old-skill'].tool_surface.removed, ['Bash']);
    assert.equal(diff.summary.removed, 1);
  });

  it('should detect changed skills - version bump', () => {
    const oldCatalog = { skills: { browse: skill() } };
    const newCatalog = {
      skills: { browse: skill({ ref: 'def5678', version: '1.1.0' }) }
    };

    const diff = diffCatalogs(oldCatalog, newCatalog);
    assert.equal(diff.skills.browse.status, 'changed');
    assert.deepEqual(diff.skills.browse.version, { old: '1.0.0', new: '1.1.0' });
    assert.equal(diff.summary.changed, 1);
  });

  it('should detect changed skills - tool surface delta', () => {
    const oldCatalog = {
      skills: { review: skill({ tool_surface: ['Bash', 'Read'] }) }
    };
    const newCatalog = {
      skills: {
        review: skill({
          ref: 'def5678',
          tool_surface: ['Bash', 'Read', 'AskUserQuestion']
        })
      }
    };

    const diff = diffCatalogs(oldCatalog, newCatalog);
    assert.equal(diff.skills.review.status, 'changed');
    assert.deepEqual(diff.skills.review.tool_surface.added, ['AskUserQuestion']);
    assert.deepEqual(diff.skills.review.tool_surface.removed, []);
  });

  it('should detect unchanged skills', () => {
    const s = skill();
    const oldCatalog = { skills: { myskill: s } };
    const newCatalog = { skills: { myskill: { ...s } } };

    const diff = diffCatalogs(oldCatalog, newCatalog);
    assert.equal(diff.skills.myskill.status, 'unchanged');
    assert.equal(diff.summary.unchanged, 1);
  });

  it('should track source-level ref changes', () => {
    const oldCatalog = { skills: { browse: skill({ ref: 'abc1234' }) } };
    const newCatalog = {
      skills: { browse: skill({ ref: 'def5678', version: '1.1.0' }) }
    };

    const diff = diffCatalogs(oldCatalog, newCatalog);
    assert.equal(diff.sources['github:garrytan/gstack'].old_ref, 'abc1234');
    assert.equal(diff.sources['github:garrytan/gstack'].new_ref, 'def5678');
  });

  it('should handle complex multi-skill diff', () => {
    const oldCatalog = {
      skills: {
        browse: skill({
          tool_surface: ['Bash', 'Read'],
          command_surface: ['browse'],
          supporting_files: ['find-browse']
        }),
        review: skill({ supporting_files: ['checklist.md'] }),
        ship: skill(),
        'old-skill': skill({ tool_surface: [] })
      }
    };
    const newCatalog = {
      skills: {
        browse: skill({
          ref: 'new456',
          version: '1.1.0',
          tool_surface: ['Bash', 'Read', 'AskUserQuestion'],
          command_surface: ['browse'],
          supporting_files: ['find-browse', 'remote-slug']
        }),
        review: skill({
          ref: 'new456',
          supporting_files: ['checklist.md', 'greptile-triage.md']
        }),
        ship: skill({ ref: 'new456' }),
        'gstack-upgrade': skill({
          ref: 'new456',
          tool_surface: ['Bash', 'Read']
        })
      }
    };

    const diff = diffCatalogs(oldCatalog, newCatalog);

    // Browse: changed (version bump + new tool + new file)
    assert.equal(diff.skills.browse.status, 'changed');
    assert.deepEqual(diff.skills.browse.version, { old: '1.0.0', new: '1.1.0' });
    assert.deepEqual(diff.skills.browse.tool_surface.added, ['AskUserQuestion']);
    assert.deepEqual(diff.skills.browse.supporting_files.added, ['remote-slug']);

    // Review: changed (new supporting file)
    assert.equal(diff.skills.review.status, 'changed');
    assert.deepEqual(diff.skills.review.supporting_files.added, ['greptile-triage.md']);

    // Ship: unchanged
    assert.equal(diff.skills.ship.status, 'unchanged');

    // Old-skill: removed
    assert.equal(diff.skills['old-skill'].status, 'removed');

    // Gstack-upgrade: new
    assert.equal(diff.skills['gstack-upgrade'].status, 'new');

    // Summary
    assert.equal(diff.summary.total, 5);
    assert.equal(diff.summary.new, 1);
    assert.equal(diff.summary.removed, 1);
    assert.equal(diff.summary.changed, 2);
    assert.equal(diff.summary.unchanged, 1);
  });

  it('should handle empty catalogs', () => {
    const diff = diffCatalogs({ skills: {} }, { skills: {} });
    assert.equal(diff.summary.total, 0);
    assert.deepEqual(diff.skills, {});
    assert.deepEqual(diff.sources, {});
  });

  it('should handle null/undefined catalogs gracefully', () => {
    const diff = diffCatalogs(null, { skills: { a: { version: '1.0.0' } } });
    assert.equal(diff.summary.new, 1);
  });
});

describe('formatCatalogDiff', () => {
  it('should format a complex diff as human-readable text', () => {
    const diff = diffCatalogs(
      {
        skills: {
          browse: skill({ ref: 'old123' }),
          removed: skill({ ref: 'old123' })
        }
      },
      {
        skills: {
          browse: skill({
            ref: 'new456',
            version: '1.1.0',
            tool_surface: ['Bash', 'Read']
          }),
          added: skill({ ref: 'new456' })
        }
      }
    );

    const output = formatCatalogDiff(diff);

    // Source header with ref change
    assert.ok(output.includes('github:garrytan/gstack  old123 -> new456'));

    // New skill
    assert.ok(output.includes('added  (new skill)'));

    // Removed skill
    assert.ok(output.includes('removed  (removed)'));

    // Changed skill with version bump
    assert.ok(output.includes('browse  1.0.0 -> 1.1.0'));
    assert.ok(output.includes('+Read'));

    // Summary
    assert.ok(output.includes('Summary: 3 skills'));
    assert.ok(output.includes('1 new'));
    assert.ok(output.includes('1 removed'));
    assert.ok(output.includes('1 changed'));
  });

  it('should show (none) for new skills with empty surfaces', () => {
    const diff = diffCatalogs(
      { skills: {} },
      {
        skills: {
          empty: skill({
            tool_surface: [],
            command_surface: [],
            supporting_files: []
          })
        }
      }
    );
    const output = formatCatalogDiff(diff);
    assert.ok(output.includes('tools:    (none)'));
    assert.ok(output.includes('commands:    (none)'));
  });

  it('should not list unchanged skills in output', () => {
    const s = skill();
    const diff = diffCatalogs({ skills: { stable: s } }, { skills: { stable: { ...s } } });
    const output = formatCatalogDiff(diff);
    // The skill name should not appear in the per-skill section (only in summary)
    assert.ok(!output.includes('  stable'));
    assert.ok(output.includes('1 unchanged'));
  });
});
