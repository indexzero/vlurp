import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  parseSourceOperand,
  replaceSourceRef,
  sourceRepositoryKey
} from '../src/source-operand.js';

describe('PURL source operands', () => {
  it('parses a GitHub PURL pattern', () => {
    const source = parseSourceOperand(
      'pkg:github/mattpocock/skills@2ab9580#skills/in-progress/writing-*'
    );

    assert.equal(source.type, 'github');
    assert.equal(source.owner, 'mattpocock');
    assert.equal(source.repo, 'skills');
    assert.equal(source.ref, '2ab9580');
    assert.equal(source.subpath, 'skills/in-progress/writing-*');
    assert.equal(source.pattern, true);
    assert.equal(sourceRepositoryKey(source), 'github:mattpocock/skills');
  });

  it('accepts an unpinned repository root', () => {
    const source = parseSourceOperand('pkg:github/mattpocock/skills');

    assert.equal(source.ref, null);
    assert.equal(source.subpath, '');
    assert.equal(source.pattern, false);
  });

  it('decodes exact subpath segments without treating encoded stars as patterns', () => {
    const source = parseSourceOperand('pkg:github/user/repo#docs/literal%2Aname.md');

    assert.equal(source.subpath, 'docs/literal*name.md');
    assert.equal(source.pattern, false);
  });

  it('replaces an embedded ref without changing the selector', () => {
    assert.equal(
      replaceSourceRef('pkg:github/user/repo@old#skills/*', 'abc1234'),
      'pkg:github/user/repo@abc1234#skills/*'
    );
    assert.equal(
      replaceSourceRef('pkg:github/user/repo#skills/*', 'abc1234'),
      'pkg:github/user/repo@abc1234#skills/*'
    );
  });

  for (const [input, message] of [
    ['pkg:npm/user/repo', 'Unsupported PURL type'],
    ['pkg:github/user', 'owner and repository'],
    ['pkg:github/user/repo@feature/*#docs', 'Glob syntax is only allowed'],
    ['pkg:github/user/repo@#docs', 'must not be empty'],
    ['pkg:github/user/repo@feature%2A#docs', 'Glob syntax is only allowed'],
    ['pkg:github/us*/repo#docs', 'Glob syntax is only allowed'],
    ['pkg:github/user/repo#/absolute', 'relative'],
    ['pkg:github/user/repo#docs/../secret', 'must not contain'],
    ['pkg:github/user/repo#docs/%2Fsecret', 'encoded slash'],
    ['github:user/repo', 'PURL']
  ]) {
    it(`rejects unsafe or unsupported source: ${input}`, () => {
      assert.throws(() => parseSourceOperand(input), new RegExp(message, 'i'));
    });
  }
});
