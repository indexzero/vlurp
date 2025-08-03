import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import archy from 'archy';

async function buildTree(dir, name = null) {
  const label = name || basename(dir);

  try {
    // Use withFileTypes to avoid stat calls
    const entries = await readdir(dir, { withFileTypes: true });

    const children = await Promise.all(entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async entry => {
        if (entry.isDirectory()) {
          return buildTree(join(dir, entry.name), entry.name);
        }

        return entry.name;
      }));

    return {
      label,
      nodes: children
    };
  } catch {
    // If readdir fails, it's likely a file, not a directory
    return label;
  }
}

export async function buildTreeString(dir) {
  try {
    const tree = await buildTree(dir);
    return archy(tree);
  } catch {
    return null;
  }
}
