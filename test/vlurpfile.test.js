import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseVlurpfile, updateRef, updateRefs } from '../src/vlurpfile.js';

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
    const content =
      'vlurp dcramer/dex -d ./skills --filter "plugins/dex/skills/dex/**" --as dex --ref 939f6cb';
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

describe('vlurpfile writer - updateRef', () => {
  it('should update an existing --ref value', () => {
    const content = 'vlurp user/repo -d ./skills --ref abc1234';
    const result = updateRef(content, 'user/repo', 'def5678');
    assert.equal(result, 'vlurp user/repo -d ./skills --ref def5678');
  });

  it('should append --ref when entry has none', () => {
    const content = 'vlurp user/repo -d ./skills --preset claude';
    const result = updateRef(content, 'user/repo', 'abc1234');
    assert.equal(result, 'vlurp user/repo -d ./skills --preset claude --ref abc1234');
  });

  it('should preserve comments and blank lines', () => {
    const content = `# Header comment

# Source A
vlurp user/repo -d ./skills --ref old1234

# Source B
vlurp other/repo -d ./skills --ref keep5678`;
    const result = updateRef(content, 'user/repo', 'new9999');
    const lines = result.split('\n');
    assert.equal(lines[0], '# Header comment');
    assert.equal(lines[1], '');
    assert.equal(lines[2], '# Source A');
    assert.equal(lines[3], 'vlurp user/repo -d ./skills --ref new9999');
    assert.equal(lines[4], '');
    assert.equal(lines[5], '# Source B');
    assert.equal(lines[6], 'vlurp other/repo -d ./skills --ref keep5678');
  });

  it('should not modify non-matching entries', () => {
    const content = `vlurp user/repo-a -d ./skills --ref aaa1111
vlurp user/repo-b -d ./skills --ref bbb2222`;
    const result = updateRef(content, 'user/repo-a', 'ccc3333');
    const lines = result.split('\n');
    assert.equal(lines[0], 'vlurp user/repo-a -d ./skills --ref ccc3333');
    assert.equal(lines[1], 'vlurp user/repo-b -d ./skills --ref bbb2222');
  });

  it('should handle lines without vlurp prefix', () => {
    const content = 'user/repo -d ./skills --ref old1234';
    const result = updateRef(content, 'user/repo', 'new5678');
    assert.equal(result, 'user/repo -d ./skills --ref new5678');
  });

  it('should update all lines matching the same source', () => {
    const content = `vlurp user/repo -d ./skills --filter "a/**" --as a --ref abc1234
vlurp user/repo -d ./skills --filter "b/**" --as b --ref abc1234`;
    const result = updateRef(content, 'user/repo', 'def5678');
    const lines = result.split('\n');
    assert.ok(lines[0].includes('--ref def5678'));
    assert.ok(lines[1].includes('--ref def5678'));
  });

  it('should handle --ref with quoted value', () => {
    const content = 'vlurp user/repo -d ./skills --ref "abc1234"';
    const result = updateRef(content, 'user/repo', 'def5678');
    assert.equal(result, 'vlurp user/repo -d ./skills --ref def5678');
  });

  it('should return content unchanged when source not found', () => {
    const content = `# Comment
vlurp other/repo -d ./skills --ref abc1234`;
    const result = updateRef(content, 'user/repo', 'def5678');
    assert.equal(result, content);
  });

  it('should preserve trailing newline', () => {
    const content = 'vlurp user/repo -d ./skills --ref abc1234\n';
    const result = updateRef(content, 'user/repo', 'def5678');
    assert.equal(result, 'vlurp user/repo -d ./skills --ref def5678\n');
  });

  it('should preserve --ref position among other flags', () => {
    const content = 'vlurp user/repo --ref abc1234 -d ./skills --preset claude';
    const result = updateRef(content, 'user/repo', 'def5678');
    assert.equal(result, 'vlurp user/repo --ref def5678 -d ./skills --preset claude');
  });
});

describe('vlurpfile writer - updateRefs', () => {
  it('should update multiple sources at once', () => {
    const content = `vlurp user/repo-a -d ./skills --ref aaa1111
vlurp user/repo-b -d ./skills --ref bbb2222
vlurp user/repo-c -d ./skills --ref ccc3333`;
    const result = updateRefs(content, {
      'user/repo-a': 'xxx1111',
      'user/repo-c': 'zzz3333'
    });
    const lines = result.split('\n');
    assert.ok(lines[0].includes('--ref xxx1111'));
    assert.ok(lines[1].includes('--ref bbb2222'));
    assert.ok(lines[2].includes('--ref zzz3333'));
  });

  it('should accept a Map', () => {
    const content = 'vlurp user/repo -d ./skills --ref old1234';
    const updates = new Map([['user/repo', 'new5678']]);
    const result = updateRefs(content, updates);
    assert.ok(result.includes('--ref new5678'));
  });

  it('should handle mixed pinned and unpinned', () => {
    const content = `vlurp pinned/repo -d ./skills --ref abc1234
vlurp unpinned/repo -d ./skills`;
    const result = updateRefs(content, {
      'pinned/repo': 'def5678',
      'unpinned/repo': '789abcd'
    });
    const lines = result.split('\n');
    assert.ok(lines[0].includes('--ref def5678'));
    assert.ok(lines[1].includes('--ref 789abcd'));
  });

  it('round-trip: parse(updateRef(content)) produces correct entries', () => {
    const original = `# Skills
vlurp garrytan/gstack -d .claude/skills --preset skills --ref abc1234

# Agent patterns
vlurp obra/superpowers -d ./skills --preset claude --ref def5678

# Unpinned
vlurp user/repo -d ./vlurp
`;
    const updated = updateRefs(original, {
      'garrytan/gstack': 'new1111',
      'obra/superpowers': 'new2222',
      'user/repo': 'new3333'
    });

    // Verify structure preserved
    const lines = updated.split('\n');
    assert.equal(lines[0], '# Skills');
    assert.equal(lines[1], 'vlurp garrytan/gstack -d .claude/skills --preset skills --ref new1111');
    assert.equal(lines[2], '');
    assert.equal(lines[3], '# Agent patterns');
    assert.equal(lines[4], 'vlurp obra/superpowers -d ./skills --preset claude --ref new2222');
    assert.equal(lines[5], '');
    assert.equal(lines[6], '# Unpinned');
    assert.equal(lines[7], 'vlurp user/repo -d ./vlurp --ref new3333');
    assert.equal(lines[8], '');

    // Verify parseable
    const entries = parseVlurpfile(updated);
    assert.equal(entries.length, 3);
    assert.equal(entries[0].ref, 'new1111');
    assert.equal(entries[0].source, 'garrytan/gstack');
    assert.equal(entries[0].preset, 'skills');
    assert.equal(entries[1].ref, 'new2222');
    assert.equal(entries[1].source, 'obra/superpowers');
    assert.equal(entries[2].ref, 'new3333');
    assert.equal(entries[2].source, 'user/repo');
  });
});
