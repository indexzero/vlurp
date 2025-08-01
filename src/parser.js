import hostedGitInfo from 'hosted-git-info';

export class Parser {
  parse(source) {
    // Try to parse with hosted-git-info
    const info = hostedGitInfo.fromUrl(source);

    if (info && info.type === 'github') {
      // Handle both regular repos and gists
      const isGist = source.includes('gist.github.com');
      return {
        type: isGist ? 'gist' : 'github',
        user: info.user,
        repo: info.project,
        tarballUrl: info.tarball(),
        info
      };
    }

    // If not a URL, try user/repo format
    if (!source.includes('://') && source.includes('/')) {
      const shorthandInfo = hostedGitInfo.fromUrl(`github:${source}`);
      if (shorthandInfo) {
        return {
          type: 'github',
          user: shorthandInfo.user,
          repo: shorthandInfo.project,
          tarballUrl: shorthandInfo.tarball(),
          info: shorthandInfo
        };
      }
    }

    throw new Error('Invalid input format. Use "user/repo" or a GitHub/Gist URL');
  }
}

export function parseSource(source) {
  const parser = new Parser();
  return parser.parse(source);
}
