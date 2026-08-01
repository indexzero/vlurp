import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { expandManifestSources, manifestSourceMatches } from '../src/manifest-sources.js';
import { parseVlurpfile } from '../src/vlurpfile.js';

describe('manifest source cohesion', () => {
  it('expands multiple PURLs into independently pinnable repository sources', () => {
    const entries = parseVlurpfile(
      'vlurp pkg:github/user/one@abc#docs pkg:github/user/two#skills/* ./content/'
    );
    const sources = expandManifestSources(entries);

    assert.deepEqual(
      sources.map(source => [source.repositoryKey, source.ref]),
      [
        ['github:user/one', 'abc'],
        ['github:user/two', null]
      ]
    );
    assert.equal(manifestSourceMatches(sources[1], 'user/two'), true);
    assert.equal(manifestSourceMatches(sources[1], 'github:user/two'), true);
  });

  it('keeps legacy vlurpfile entries available during migration', () => {
    const sources = expandManifestSources(
      parseVlurpfile('vlurp user/repo -d ./content --ref abc1234')
    );

    assert.equal(sources[0].repositoryKey, 'github:user/repo');
    assert.equal(sources[0].ref, 'abc1234');
  });
});
