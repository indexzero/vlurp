import process from 'node:process';
import { resolve, join } from 'node:path';
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { parseSource } from '../parser.js';
import { validateUrl } from '../validator.js';
import { fetchRepository } from '../fetcher.js';
import { buildTreeString } from '../tree.js';

export function FetchCommand({ source, rootDir, filters, force }) {
  const [status, setStatus] = useState('locating');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [treeOutput, setTreeOutput] = useState(null);

  useEffect(() => {
    async function performFetch() {
      try {
        // Parse the source input
        setStatus('locating');
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

        // Vlurp the repository
        setStatus('vlurping');
        const { fileCount } = await fetchRepository(parsed.tarballUrl, targetPath, filters, { force });

        // Generate tree output
        const tree = await buildTreeString(targetPath);
        setTreeOutput(tree);

        setResult({
          user: parsed.user,
          repo: parsed.repo,
          path: targetPath,
          filterCount: filters.length,
          fileCount
        });
        setStatus('complete');
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    }

    performFetch();
  }, [source, rootDir, filters, force]);

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
      React.createElement(Text, { color: 'green' }, `✓ Successfully vlurped ${result.user}/${result.repo}`),
      React.createElement(Text, { color: 'gray' }, `  Location: ${result.path}`),
      result.filterCount > 0 && React.createElement(Text, { color: 'gray' }, `  Filters: ${result.filterCount} pattern(s) applied`),
      treeOutput && React.createElement(Box, { marginTop: 1 }, React.createElement(Text, null, treeOutput)),
      React.createElement(Text, { color: 'cyan', marginTop: 1 }, `✨ vlurped ${result.fileCount} files to ${result.path}`)
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
    React.createElement(Text, null, ` ${status === 'parsing' ? 'Parsing input...' : 'vlurping repository...'}`)
  );
}

export function resolveTargetPath(user, repo, rootDir) {
  const userRepoPath = join(user, repo);

  if (rootDir) {
    return resolve(rootDir, userRepoPath);
  }

  return resolve(process.cwd(), userRepoPath);
}
