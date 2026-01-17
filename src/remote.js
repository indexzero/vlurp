import {
  access, mkdir, readdir, cp, rm
} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {constants, createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {tmpdir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline';
import process from 'node:process';
import {extract} from 'tar';
import {request} from 'undici';
import {glob} from 'glob';
import hostedGitInfo from 'hosted-git-info';

// --- Parsing ---

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

// --- Validation ---

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

// --- Fetching ---

export class Fetcher {
  async #ensureDirectory(targetPath) {
    const dir = dirname(targetPath);
    try {
      await access(dir, constants.F_OK);
    } catch {
      await mkdir(dir, {recursive: true});
    }
  }

  async #checkIfExists(targetPath) {
    try {
      await access(targetPath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async #downloadTarball(url) {
    const temporaryFile = join(tmpdir(), `vlurp-${randomBytes(8).toString('hex')}.tar.gz`);

    const {statusCode, body} = await request(url, {
      headers: {
        'User-Agent': 'vlurp-cli'
      }
    });

    if (statusCode !== 200) {
      throw new Error(`Failed to download tarball: HTTP ${statusCode}`);
    }

    const fileStream = createWriteStream(temporaryFile);
    await pipeline(body, fileStream);

    return temporaryFile;
  }

  async #extractTarball(tarballPath, targetPath, filters = []) {
    // Create parent directory
    await this.#ensureDirectory(targetPath);

    // Extract to a temp directory first
    const temporaryExtractDir = join(tmpdir(), `vlurp-extract-${randomBytes(8).toString('hex')}`);
    await mkdir(temporaryExtractDir, {recursive: true});

    // Extract everything first
    await extract({
      file: tarballPath,
      cwd: temporaryExtractDir,
      strip: 1 // Strip the top-level directory from the tarball
    });

    // If no filters provided, copy everything
    if (!filters || filters.length === 0) {
      await cp(temporaryExtractDir, targetPath, {recursive: true});
    } else {
      // Separate positive and negative patterns
      const ignorePatterns = filters
        .filter(p => p.startsWith('!'))
        .map(p => p.slice(1)); // Remove the ! prefix

      const includePatterns = filters
        .filter(p => !p.startsWith('!'));

      // If no positive patterns, include everything by default
      const patterns = includePatterns.length > 0 ? includePatterns : ['**/*'];

      // Use glob to find matching files
      const matchedFiles = await glob(patterns, {
        cwd: temporaryExtractDir,
        ignore: ignorePatterns,
        dot: true,
        nodir: false
      });

      // Create target directory
      await mkdir(targetPath, {recursive: true});

      // Copy matched files maintaining directory structure

      for (const file of matchedFiles) {
        const sourcePath = join(temporaryExtractDir, file);
        const destPath = join(targetPath, file);

        // Ensure parent directory exists
        // eslint-disable-next-line no-await-in-loop
        await mkdir(dirname(destPath), {recursive: true});

        // Copy file or directory
        // eslint-disable-next-line no-await-in-loop
        await cp(sourcePath, destPath, {recursive: true});
      }
    }

    // Clean up temp directory
    await rm(temporaryExtractDir, {recursive: true, force: true});
  }

  async countFiles(dir) {
    try {
      const files = await readdir(dir, {recursive: true});
      return files.length;
    } catch {
      return 0;
    }
  }

  async #promptUser(question) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise(resolve => {
      rl.question(question, answer => {
        rl.close();
        resolve(answer);
      });
    });
  }

  async fetch(tarballUrl, targetPath, filters = [], options = {}) {
    // Check if target already exists
    if (await this.#checkIfExists(targetPath)) {
      if (!options.force) {
        const fileCount = await this.countFiles(targetPath);
        // For now, we'll keep these console.logs as they happen before Ink takes over
        // In a more complete solution, we'd handle this in the Ink component
        console.log(`\nWarning: Directory ${targetPath} already exists with ${fileCount} files.`);
        console.log('Continuing will overwrite existing files.');

        const answer = await this.#promptUser('Continue? (y/N): ');
        if (answer.toLowerCase() !== 'y') {
          console.log('vlurping cancelled.');
          process.exit(0);
        }
      }

      // Remove existing directory before proceeding
      await rm(targetPath, {recursive: true, force: true});
    }

    let temporaryTarball;
    try {
      // Download tarball
      temporaryTarball = await this.#downloadTarball(tarballUrl);

      // Extract to target path
      await this.#extractTarball(temporaryTarball, targetPath, filters);
    } finally {
      // Clean up temp file
      if (temporaryTarball) {
        const {unlink} = await import('node:fs/promises');
        await unlink(temporaryTarball, {force: true});
      }
    }
  }
}

export async function fetchRepository(tarballUrl, targetPath, filters = [], options = {}) {
  const fetcher = new Fetcher();
  await fetcher.fetch(tarballUrl, targetPath, filters, options);

  // Return file count for the component to display
  const fileCount = await fetcher.countFiles(targetPath);
  return {fileCount};
}
