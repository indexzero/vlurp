import { request } from 'undici';
import { extract } from 'tar';
import { minimatch } from 'minimatch';
import { access, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { constants } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

export class Cloner {
  async #ensureDirectory(targetPath) {
    const dir = dirname(targetPath);
    try {
      await access(dir, constants.F_OK);
    } catch {
      await mkdir(dir, { recursive: true });
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
    const tempFile = join(tmpdir(), `vlurp-${randomBytes(8).toString('hex')}.tar.gz`);

    const { statusCode, body } = await request(url, {
      headers: {
        'User-Agent': 'vlurp-cli'
      }
    });

    if (statusCode !== 200) {
      throw new Error(`Failed to download tarball: HTTP ${statusCode}`);
    }

    const fileStream = createWriteStream(tempFile);
    await pipeline(body, fileStream);

    return tempFile;
  }

  async #extractTarball(tarballPath, targetPath, filters = []) {
    // Create parent directory
    await this.#ensureDirectory(targetPath);

    // Extract to a temp directory first
    const tempExtractDir = join(tmpdir(), `vlurp-extract-${randomBytes(8).toString('hex')}`);
    await mkdir(tempExtractDir, { recursive: true });

    const extractOptions = {
      file: tarballPath,
      cwd: tempExtractDir,
      strip: 1 // Strip the top-level directory from the tarball
    };

    // Add filter if patterns are provided
    if (filters && filters.length > 0) {
      extractOptions.filter = (path) => {
        // Strip leading slash if present (tar sometimes includes it)
        let normalizedPath = path.startsWith('/') ? path.slice(1) : path;

        // Strip the first directory component (e.g., "claude-task-master-HEAD/")
        // This matches what the strip: 1 option does
        const firstSlash = normalizedPath.indexOf('/');
        if (firstSlash !== -1) {
          normalizedPath = normalizedPath.slice(firstSlash + 1);
        }

        // Check if the path matches any of the filter patterns
        const matches = filters.some(pattern => {
          // For debugging: uncomment to see what's being filtered
          // console.log(`Checking ${normalizedPath} against ${pattern}`);
          return minimatch(normalizedPath, pattern, { matchBase: true, dot: true });
        });

        return matches;
      };
    }

    await extract(extractOptions);

    // Move to final location
    await rename(tempExtractDir, targetPath);
  }

  async clone(tarballUrl, targetPath, filters = []) {
    // Check if target already exists
    if (await this.#checkIfExists(targetPath)) {
      throw new Error(`Directory already exists: ${targetPath}`);
    }

    let tempTarball;
    try {
      // Download tarball
      tempTarball = await this.#downloadTarball(tarballUrl);

      // Extract to target path
      await this.#extractTarball(tempTarball, targetPath, filters);
    } finally {
      // Clean up temp file
      if (tempTarball) {
        const { unlink } = await import('node:fs/promises');
        await unlink(tempTarball).catch(() => {});
      }
    }
  }
}

export async function cloneRepository(tarballUrl, targetPath, filters = []) {
  const cloner = new Cloner();
  return await cloner.clone(tarballUrl, targetPath, filters);
}
