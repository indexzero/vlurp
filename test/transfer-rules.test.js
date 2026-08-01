import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { compileTransferRules } from '../src/transfer-rules.js';

describe('transfer glob rules', () => {
  it('uses positive globs as an allowlist and supports exclusions', () => {
    const rules = compileTransferRules({
      globs: ['**/*.md', '!README.md']
    });

    assert.equal(rules.matches('skills/example/SKILL.md'), true);
    assert.equal(rules.matches('README.md'), false);
    assert.equal(rules.matches('skills/example/script.js'), false);
  });

  it('makes iglob rules case-insensitive', () => {
    const sensitive = compileTransferRules({ globs: ['**/skill.md'] });
    const insensitive = compileTransferRules({ iglobs: ['**/skill.md'] });

    assert.equal(sensitive.matches('skills/example/SKILL.md'), false);
    assert.equal(insensitive.matches('skills/example/SKILL.md'), true);
  });

  it('lets later explicit rules override preset rules', () => {
    const rules = compileTransferRules({
      preset: 'skills',
      globs: ['README.md']
    });

    assert.equal(rules.matches('README.md'), true);
    assert.equal(rules.matches('LICENSE'), false);
    assert.equal(rules.matches('skills/example/SKILL.md'), true);
  });

  it('includes unmatched files when every rule is an exclusion', () => {
    const rules = compileTransferRules({ globs: ['!**/*.tmp'] });

    assert.equal(rules.matches('src/index.js'), true);
    assert.equal(rules.matches('cache/result.tmp'), false);
  });

  it('rejects unknown presets and empty patterns', () => {
    assert.throws(() => compileTransferRules({ preset: 'missing' }), /unknown preset/i);
    assert.throws(() => compileTransferRules({ globs: [''] }), /must not be empty/i);
  });
});
