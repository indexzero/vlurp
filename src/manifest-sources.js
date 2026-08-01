import { parseSource } from './remote.js';
import { parseSourceOperand, sourceRepositoryKey } from './source-operand.js';

/** Flatten vlurpfile commands into independently pinnable repository sources. */
export function expandManifestSources(entries) {
  const sources = [];
  for (const entry of entries) {
    if (entry.mode === 'copy') {
      for (const raw of entry.sources) {
        const parsed = parseSourceOperand(raw);
        sources.push({
          entry,
          raw,
          user: parsed.owner,
          repo: parsed.repo,
          ref: parsed.ref,
          repositoryKey: sourceRepositoryKey(parsed),
          purl: parsed
        });
      }
    } else {
      const parsed = parseSource(entry.source, { ref: entry.ref });
      sources.push({
        entry,
        raw: entry.source,
        user: parsed.user,
        repo: parsed.repo,
        ref: entry.ref,
        repositoryKey: `github:${parsed.user}/${parsed.repo}`,
        purl: null
      });
    }
  }

  return sources;
}

export function manifestSourceMatches(source, query) {
  return (
    source.raw === query ||
    source.repositoryKey === query ||
    `${source.user}/${source.repo}` === query ||
    source.raw.includes(query)
  );
}
