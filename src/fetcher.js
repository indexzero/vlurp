import {
  access, mkdir, readdir, cp, rm
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { constants, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { extract } from 'tar';
import { request } from 'undici';
import { glob } from 'glob';

export class Fetcher {
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

    // Extract everything first
    await extract({
      file: tarballPath,
      cwd: tempExtractDir,
      strip: 1 // Strip the top-level directory from the tarball
    });

    // If no filters provided, copy everything
    if (!filters || filters.length === 0) {
      await cp(tempExtractDir, targetPath, { recursive: true });
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
        cwd: tempExtractDir,
        ignore: ignorePatterns,
        dot: true,
        nodir: false
      });

      // Create target directory
      await mkdir(targetPath, { recursive: true });

      // Copy matched files maintaining directory structure

      for (const file of matchedFiles) {
        const sourcePath = join(tempExtractDir, file);
        const destPath = join(targetPath, file);

        // Ensure parent directory exists
        // eslint-disable-next-line no-await-in-loop
        await mkdir(dirname(destPath), { recursive: true });

        // Copy file or directory
        // eslint-disable-next-line no-await-in-loop
        await cp(sourcePath, destPath, { recursive: true });
      }
    }

    // Clean up temp directory
    await rm(tempExtractDir, { recursive: true, force: true });
  }

  async countFiles(dir) {
    try {
      const files = await readdir(dir, { recursive: true });
      return files.length;
    } catch {
      return 0;
    }
  }

  async checkDirectory(targetPath) {
    const exists = await this.#checkIfExists(targetPath);
    if (!exists) {
      return { exists: false, fileCount: 0 };
    }

    const fileCount = await this.countFiles(targetPath);
    return { exists: true, fileCount };
  }

  async fetch(tarballUrl, targetPath, filters = [], options = {}) {
    // If directory exists, remove it (caller should have already confirmed)
    if (await this.#checkIfExists(targetPath)) {
      await rm(targetPath, { recursive: true, force: true });
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
        await unlink(tempTarball, { force: true });
      }
    }
  }
}

export async function checkTargetDirectory(targetPath) {
  const fetcher = new Fetcher();
  return fetcher.checkDirectory(targetPath);
}

export async function fetchRepository(tarballUrl, targetPath, filters = [], options = {}) {
  const fetcher = new Fetcher();
  await fetcher.fetch(tarballUrl, targetPath, filters, options);

  // Return file count for the component to display
  const fileCount = await fetcher.countFiles(targetPath);
  return { fileCount };
}
