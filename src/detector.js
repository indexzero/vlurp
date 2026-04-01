import { request } from 'undici';

/**
 * Structure detection patterns and their associated filters.
 * Order matters - more specific patterns should come first.
 */
const STRUCTURE_PATTERNS = [
  {
    name: 'claude-dot',
    test: files => files.some(f => f.startsWith('.claude/')),
    filters: ['.claude/**', 'CLAUDE.md']
  },
  {
    name: 'claude-dir',
    test: files => files.some(f => f.startsWith('claude/') && !f.startsWith('.claude/')),
    filters: ['claude/**', 'CLAUDE.md']
  },
  {
    name: 'skills',
    test: files => files.some(f => f.startsWith('skills/') || f === 'SKILL.md'),
    filters: ['skills/**', 'SKILL.md', '**/*.md', '!README.md']
  },
  {
    name: 'agents',
    test: files => files.some(f => f.startsWith('agents/')),
    filters: ['agents/**', '**/*.md', '!README.md']
  },
  {
    name: 'commands',
    test: files => files.some(f => f.startsWith('commands/')),
    filters: ['commands/**', '**/*.md', '!README.md']
  },
  {
    name: 'tools',
    test: files => files.some(f => f.startsWith('tools/')),
    filters: ['tools/**', '**/*.md', '!README.md']
  },
  {
    name: 'concepts',
    test: files => files.some(f => f.startsWith('concepts/')),
    filters: ['concepts/**', '**/*.md', '!README.md']
  },
  {
    name: 'stacks',
    test: files => files.some(f => f.startsWith('stacks/')),
    filters: ['stacks/**', '**/*.md', '!README.md']
  },
  {
    name: 'snips',
    test: files => files.some(f => f.startsWith('snips/')),
    filters: ['snips/**', '**/*.md', '!README.md']
  },
  {
    name: 'dev-specs',
    test: files => files.some(f => f.startsWith('.dev/')),
    filters: ['.dev/**', '**/*.md', '!README.md']
  }
];

/**
 * Fetches the file tree from a GitHub repository using the API.
 * Falls back to tarball inspection if API fails.
 */
async function fetchRepoTree(user, repo) {
  try {
    const url = `https://api.github.com/repos/${user}/${repo}/git/trees/HEAD?recursive=1`;
    const { statusCode, body } = await request(url, {
      headers: {
        'User-Agent': 'vlurp-cli',
        Accept: 'application/vnd.github.v3+json'
      }
    });

    if (statusCode !== 200) {
      return null;
    }

    const data = await body.json();
    return data.tree?.map(item => item.path) || null;
  } catch {
    return null;
  }
}

/**
 * Detects repository structure and returns appropriate filters.
 * Combines filters from all matching patterns.
 */
export async function detectStructure(user, repo) {
  const files = await fetchRepoTree(user, repo);

  if (!files || files.length === 0) {
    // Fallback to default filters if detection fails
    return {
      detected: false,
      patterns: [],
      filters: ['.claude/**', 'CLAUDE.md', '**/*.md', '!README.md', '!LICENSE*']
    };
  }

  const matchedPatterns = STRUCTURE_PATTERNS.filter(pattern => pattern.test(files));

  if (matchedPatterns.length === 0) {
    // No specific structure detected, use docs pattern
    return {
      detected: true,
      patterns: ['docs'],
      filters: ['**/*.md', '!README.md', '!CONTRIBUTING.md', '!LICENSE*', '!CHANGELOG.md']
    };
  }

  // Combine filters from all matched patterns, deduplicating
  const allFilters = [...new Set(matchedPatterns.flatMap(p => p.filters))];

  return {
    detected: true,
    patterns: matchedPatterns.map(p => p.name),
    filters: allFilters
  };
}

/**
 * Synchronous structure detection from a list of files.
 * Useful when you already have the file list (e.g., from extracted tarball).
 */
export function detectStructureSync(files) {
  const matchedPatterns = STRUCTURE_PATTERNS.filter(pattern => pattern.test(files));

  if (matchedPatterns.length === 0) {
    return {
      detected: false,
      patterns: [],
      filters: ['**/*.md', '!README.md', '!CONTRIBUTING.md', '!LICENSE*']
    };
  }

  const allFilters = [...new Set(matchedPatterns.flatMap(p => p.filters))];

  return {
    detected: true,
    patterns: matchedPatterns.map(p => p.name),
    filters: allFilters
  };
}
