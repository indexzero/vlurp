import { resolve, join } from 'node:path';
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

import { parseSource } from '../parser.js';
import { validateUrl } from '../validator.js';
import { cloneRepository } from '../cloner.js';

export function CloneCommand({ source, rootDir, filters }) {
  const [status, setStatus] = useState('parsing');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    async function performClone() {
      try {
        // Parse the source input
        setStatus('parsing');
        const parsed = parseSource(source);

        // Validate if it's a URL
        if (parsed.type === 'url') {
          const validation = validateUrl(parsed.url);
          if (!validation.valid) {
            throw new Error(validation.error);
          }
        }

        // Resolve the target directory
        const targetPath = resolveTargetPath(parsed.user, parsed.repo, rootDir);

        // Clone the repository
        setStatus('cloning');
        await cloneRepository(parsed.tarballUrl, targetPath, filters);

        setResult({
          user: parsed.user,
          repo: parsed.repo,
          path: targetPath,
          filterCount: filters.length
        });
        setStatus('complete');
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    }

    performClone();
  }, [source, rootDir, filters]);

  if (status === 'error') {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, { color: 'red' }, `✗ Error: ${error}`)
    );
  }

  if (status === 'complete') {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, { color: 'green' }, `✓ Successfully cloned ${result.user}/${result.repo}`),
      React.createElement(Text, { color: 'gray' }, `  Location: ${result.path}`),
      result.filterCount > 0 && React.createElement(Text, { color: 'gray' }, `  Filters: ${result.filterCount} pattern(s) applied`)
    );
  }

  return React.createElement(
    Box,
    null,
    React.createElement(
      Text,
      null,
      React.createElement(Spinner, { type: 'dots' })
    ),
    React.createElement(Text, null, ` ${status === 'parsing' ? 'Parsing input...' : 'Cloning repository...'}`)
  );
}

export function resolveTargetPath(user, repo, rootDir) {
  const userRepoPath = join(user, repo);

  if (rootDir) {
    return resolve(rootDir, userRepoPath);
  }

  return resolve(process.cwd(), userRepoPath);
}
