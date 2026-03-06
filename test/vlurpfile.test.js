import {describe, it} from 'node:test';
import {strict as assert} from 'node:assert';
import {parseVlurpfile} from '../src/vlurpfile.js';

describe('vlurpfile parser', () => {
  it('should parse --ref flag', () => {
    const content = 'vlurp dcramer/dex -d ./skills --ref 939f6cb';
    const entries = parseVlurpfile(content);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ref, '939f6cb');
  });

  it('should parse --as flag', () => {
    const content = 'vlurp dcramer/dex -d ./skills --filter "skills/**" --as dex';
    const entries = parseVlurpfile(content);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].as, 'dex');
  });

  it('should resolve target path with --as', () => {
    const content = 'vlurp dcramer/dex -d ./skills --as dex';
    const entries = parseVlurpfile(content);
    assert.ok(entries[0].targetPath.endsWith('/skills/dex'));
  });

  it('should parse combined --ref and --as', () => {
    const content = 'vlurp dcramer/dex -d ./skills --filter "plugins/dex/skills/dex/**" --as dex --ref 939f6cb';
    const entries = parseVlurpfile(content);
    assert.equal(entries[0].ref, '939f6cb');
    assert.equal(entries[0].as, 'dex');
    assert.ok(entries[0].targetPath.endsWith('/skills/dex'));
  });

  it('should have null ref when not specified', () => {
    const content = 'vlurp user/repo -d ./vlurp';
    const entries = parseVlurpfile(content);
    assert.equal(entries[0].ref, null);
  });

  it('should have null as when not specified', () => {
    const content = 'vlurp user/repo -d ./vlurp';
    const entries = parseVlurpfile(content);
    assert.equal(entries[0].as, null);
  });

  it('should parse a full vlurpfile with mixed entries', () => {
    const content = `# .vlurpfile.skills - Agent skill sources, reviewed and pinned

# dcramer/dex -- Task management skills
vlurp dcramer/dex -d ./skills --filter "plugins/dex/skills/dex/**" --as dex --ref 939f6cb
vlurp dcramer/dex -d ./skills --filter "plugins/dex/skills/dex-plan/**" --as dex-plan --ref 939f6cb

# obra/superpowers -- Core agent patterns
vlurp obra/superpowers -d ./skills --preset skills --ref abc1234

# Unpinned source
vlurp user/repo -d ./vlurp
`;
    const entries = parseVlurpfile(content);
    assert.equal(entries.length, 4);
    assert.equal(entries[0].as, 'dex');
    assert.equal(entries[0].ref, '939f6cb');
    assert.equal(entries[1].as, 'dex-plan');
    assert.equal(entries[2].preset, 'skills');
    assert.equal(entries[2].ref, 'abc1234');
    assert.equal(entries[3].ref, null);
  });
});
