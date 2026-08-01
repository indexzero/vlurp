import { Minimatch } from 'minimatch';

export function parseSourceOperand(input) {
  if (typeof input !== 'string' || !input.startsWith('pkg:')) {
    throw new Error('Remote sources must be Package URLs (PURLs) beginning with "pkg:"');
  }

  const match = /^pkg:([^/]+)\/([^?#]+)(?:\?([^#]*))?(?:#(.*))?$/.exec(input);
  if (!match) {
    throw new Error(`Malformed PURL source: ${input}`);
  }

  const [, rawType, rawPath, rawQualifiers = '', rawSubpath = ''] = match;
  const type = decodePart(rawType, 'type').toLowerCase();
  if (type !== 'github') {
    throw new Error(`Unsupported PURL type "${type}"; vlurp currently supports pkg:github`);
  }

  const at = rawPath.lastIndexOf('@');
  const rawRepository = at === -1 ? rawPath : rawPath.slice(0, at);
  const rawRef = at === -1 ? '' : rawPath.slice(at + 1);
  if (at !== -1 && !rawRef) {
    throw new Error('A PURL @ref must not be empty');
  }
  const repositorySegments = rawRepository.split('/');
  if (repositorySegments.length !== 2 || repositorySegments.some(segment => !segment)) {
    throw new Error('A pkg:github source must contain exactly one owner and repository');
  }

  if (hasGlobMagic(rawRepository) || hasGlobMagic(rawRef)) {
    throw new Error('Glob syntax is only allowed in a PURL #subpath');
  }

  const owner = decodePart(repositorySegments[0], 'owner');
  const repo = decodePart(repositorySegments[1], 'repository');
  const ref = rawRef ? decodePart(rawRef, 'ref') : null;
  if (hasGlobMagic(owner) || hasGlobMagic(repo) || hasGlobMagic(ref || '')) {
    throw new Error('Glob syntax is only allowed in a PURL #subpath');
  }
  const subpath = decodeSubpath(rawSubpath);
  validateSubpath(subpath, rawSubpath);

  return {
    raw: input,
    type,
    owner,
    repo,
    ref,
    qualifiers: parseQualifiers(rawQualifiers),
    subpath,
    pattern: hasGlobMagic(rawSubpath),
    tarballUrl:
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/tarball/${ref ? encodeURIComponent(ref) : ''}`.replace(
        /\/$/,
        ''
      )
  };
}

export function sourceRepositoryKey(source) {
  const parsed = typeof source === 'string' ? parseSourceOperand(source) : source;
  return `${parsed.type}:${parsed.owner}/${parsed.repo}`;
}

export function replaceSourceRef(input, newRef) {
  if (!newRef || hasGlobMagic(newRef)) {
    throw new Error('A replacement ref must be exact and non-empty');
  }

  const parsed = parseSourceOperand(input);
  const qualifierText = formatQualifiers(parsed.qualifiers);
  const subpathText = input.includes('#') ? input.slice(input.indexOf('#')) : '';
  return `pkg:github/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}@${encodeURIComponent(newRef)}${qualifierText}${subpathText}`;
}

function decodePart(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`Malformed percent-encoding in PURL ${label}`);
  }
}

function decodeSubpath(rawSubpath) {
  if (!rawSubpath) {
    return '';
  }

  return rawSubpath
    .split('/')
    .map(segment => decodePart(segment, 'subpath'))
    .join('/');
}

function validateSubpath(subpath, rawSubpath) {
  if (!subpath) {
    return;
  }

  if (subpath.startsWith('/') || subpath.startsWith('\\')) {
    throw new Error('A PURL subpath must be relative to the repository root');
  }

  if (/%2f|%5c/i.test(rawSubpath)) {
    throw new Error('A PURL subpath segment must not contain an encoded slash');
  }

  const segments = subpath.split('/');
  if (segments.some(segment => segment === '.' || segment === '..' || segment === '')) {
    throw new Error('A PURL subpath must not contain empty, ".", or ".." segments');
  }

  if (segments.some(segment => segment.includes('\\') || segment.includes('\0'))) {
    throw new Error('A PURL subpath contains an unsafe path character');
  }
}

function parseQualifiers(raw) {
  if (!raw) {
    return [];
  }

  return raw.split('&').map(pair => {
    const separator = pair.indexOf('=');
    if (separator < 1) {
      throw new Error('Malformed PURL qualifier; expected key=value');
    }

    return [
      decodePart(pair.slice(0, separator), 'qualifier'),
      decodePart(pair.slice(separator + 1), 'qualifier')
    ];
  });
}

function formatQualifiers(qualifiers) {
  if (qualifiers.length === 0) {
    return '';
  }

  return `?${qualifiers
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')}`;
}

function hasGlobMagic(value) {
  return new Minimatch(value, { magicalBraces: true }).hasMagic();
}
