import { resolve } from 'node:path';
import { PRESETS } from './presets.js';

/**
 * Parses a .vlurpfile and returns an array of vlurp commands.
 * 
 * Format:
 *   # Comments start with #
 *   vlurp user/repo -d ./vlurp
 *   vlurp user/repo -d ./vlurp --filter "pattern"
 *   vlurp user/repo --preset claude
 */
export function parseVlurpfile(content) {
  const lines = content.split('\n');
  const entries = [];

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    
    // Parse the vlurp command
    const entry = parseVlurpLine(trimmed);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Parses a single vlurp command line.
 */
function parseVlurpLine(line) {
  // Remove 'vlurp' prefix if present
  const command = line.startsWith('vlurp ') ? line.slice(6).trim() : line;
  
  // Simple argument parser
  const args = parseArgs(command);
  
  if (args.length === 0) {
    return null;
  }
  
  const source = args[0];
  const entry = {
    source,
    rootDir: null,
    filters: [],
    preset: null,
    force: false
  };
  
  // Parse options
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '-d' && args[i + 1]) {
      entry.rootDir = args[++i];
    } else if (arg === '--filter' && args[i + 1]) {
      entry.filters.push(args[++i]);
    } else if (arg === '--preset' && args[i + 1]) {
      entry.preset = args[++i];
      if (PRESETS[entry.preset]) {
        entry.filters = [...PRESETS[entry.preset].filters];
      }
    } else if (arg === '-f' || arg === '--force') {
      entry.force = true;
    }
  }
  
  // Calculate target path
  if (entry.rootDir) {
    const parts = source.split('/');
    if (parts.length >= 2) {
      const [user, repo] = parts;
      entry.targetPath = resolve(entry.rootDir, user, repo);
    }
  }
  
  return entry;
}

/**
 * Simple argument parser that handles quoted strings.
 */
function parseArgs(str) {
  const args = [];
  const regex = /(?:[^\s"]+|"[^"]*")+/g;
  let match;
  
  while ((match = regex.exec(str)) !== null) {
    // Remove surrounding quotes
    args.push(match[0].replace(/^"|"$/g, ''));
  }
  
  return args;
}
