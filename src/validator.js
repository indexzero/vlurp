import hostedGitInfo from 'hosted-git-info';

export class Validator {
  validate(url) {
    if (!url || typeof url !== 'string') {
      return {
        valid: false,
        error: 'Invalid URL provided'
      };
    }

    const info = hostedGitInfo.fromUrl(url);
    
    if (info && info.type === 'github') {
      const isGist = url.includes('gist.github.com');
      return {
        valid: true,
        type: isGist ? 'gist' : 'github',
        user: info.user,
        repo: info.project
      };
    }

    return {
      valid: false,
      error: 'URL must be from github.com or gist.github.com'
    };
  }
}

export function validateUrl(url) {
  const validator = new Validator();
  return validator.validate(url);
}