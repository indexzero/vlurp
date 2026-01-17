import process from 'node:process';
import { resolve, join } from 'node:path';
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { parseSource } from '../parser.js';
import { validateUrl } from '../validator.js';
import { fetchRepository } from '../fetcher.js';
import { detectStructure } from '../detector.js';
import { buildTreeString } from '../tree.js';

export function FetchCommand({ source, rootDir, filters, force, auto, dryRun, quiet }) {
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

        // Auto-detect structure if requested
        let effectiveFilters = filters;
        let detectedPatterns = [];
        
        if (auto) {
          setStatus('detecting');
          const detection = await detectStructure(parsed.user, parsed.repo);
          if (detection.detected) {
            effectiveFilters = detection.filters;
            detectedPatterns = detection.patterns;
          }
        }

        // Resolve the target directory
        const targetPath = resolveTargetPath(parsed.user, parsed.repo, rootDir);
        
        // Dry run - just show what would happen
        if (dryRun) {
          setResult({
            user: parsed.user,
            repo: parsed.repo,
            path: targetPath,
            filters: effectiveFilters,
            detectedPatterns
          });
          setStatus('dry-run');
          return;
        }

        // Vlurp the repository
        setStatus('vlurping');
        const { fileCount } = await fetchRepository(parsed.tarballUrl, targetPath, effectiveFilters, { force });

        // Generate tree output
        const tree = await buildTreeString(targetPath);
        setTreeOutput(tree);

        setResult({
          user: parsed.user,
          repo: parsed.repo,
          path: targetPath,
          filterCount: effectiveFilters.length,
          fileCount,
          detectedPatterns
        });
        setStatus('complete');
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    }

    performFetch();
  }, [source, rootDir, filters, force, auto, dryRun]);

  if (status === 'error') {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, { color: 'red' }, `✗ Error: ${error}`)
    );
  }

  if (status === 'dry-run') {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, { color: 'yellow', bold: true }, `📋 Dry run - would fetch ${result.user}/${result.repo}`),
      React.createElement(Text, { color: 'gray' }, `  Target: ${result.path}`),
      result.detectedPatterns?.length > 0 && 
        React.createElement(Text, { color: 'cyan' }, `  Auto-detected: ${result.detectedPatterns.join(', ')}`),
      React.createElement(Text, { color: 'gray' }, `  Filters: ${result.filters.slice(0, 5).join(', ')}${result.filters.length > 5 ? '...' : ''}`),
      React.createElement(Text, { color: 'gray', marginTop: 1 }, '\nRun without --dry-run to execute.')
    );
  }

  if (status === 'detecting') {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, null, React.createElement(Spinner, { type: 'dots' })),
      React.createElement(Text, null, ' Auto-detecting repository structure...')
    );
  }

  if (status === 'complete') {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, { color: 'green' }, `✓ Successfully vlurped ${result.user}/${result.repo}`),
      React.createElement(Text, { color: 'gray' }, `  Location: ${result.path}`),
      result.detectedPatterns?.length > 0 &&
        React.createElement(Text, { color: 'cyan' }, `  Auto-detected: ${result.detectedPatterns.join(', ')}`),
      result.filterCount > 0 && React.createElement(Text, { color: 'gray' }, `  Filters: ${result.filterCount} pattern(s) applied`),
      treeOutput && !quiet && React.createElement(Box, { marginTop: 1 }, React.createElement(Text, null, treeOutput)),
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
    React.createElement(Text, null, ` ${status === 'locating' ? 'Locating repository...' : 'vlurping repository...'}`)
  );
}

export function resolveTargetPath(user, repo, rootDir) {
  const userRepoPath = join(user, repo);

  if (rootDir) {
    return resolve(rootDir, userRepoPath);
  }

  return resolve(process.cwd(), userRepoPath);
}
