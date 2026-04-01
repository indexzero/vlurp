import { join, resolve } from 'node:path';
import process from 'node:process';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React, { useEffect, useState } from 'react';
import { detectStructure } from '../detector.js';
import { appendLineage, createLineageRecord, hashDirectory } from '../lineage.js';
import { fetchRepository, parseSource, validateUrl } from '../remote.js';
import { buildTreeString } from '../tree.js';

export function FetchCommand({
  source,
  rootDir,
  filters,
  force,
  auto,
  dryRun,
  quiet,
  ref,
  asName,
  preset
}) {
  const [status, setStatus] = useState('locating');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [treeOutput, setTreeOutput] = useState(null);

  useEffect(() => {
    async function performFetch() {
      try {
        // Parse the source input
        setStatus('locating');
        const parsed = parseSource(source, { ref });

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
        const targetPath = resolveTargetPath(parsed.user, parsed.repo, rootDir, asName);

        // Dry run - just show what would happen
        if (dryRun) {
          setResult({
            user: parsed.user,
            repo: parsed.repo,
            path: targetPath,
            filters: effectiveFilters,
            detectedPatterns,
            ref: ref || null,
            asName: asName || null
          });
          setStatus('dry-run');
          return;
        }

        // Warn if not pinned
        if (!ref && !quiet) {
          setStatus('vlurping');
        } else {
          setStatus('vlurping');
        }

        // Vlurp the repository
        const { fileCount } = await fetchRepository(
          parsed.tarballUrl,
          targetPath,
          effectiveFilters,
          { force }
        );

        // Generate lineage record
        // File paths are relative to targetPath; we store them as-is
        // since the JSONL lives at the rootDir level and the record's
        // source identity (user/repo or --as) provides the path context
        const rawFiles = await hashDirectory(targetPath);
        const lineageRecord = createLineageRecord({
          source: `${parsed.user}/${parsed.repo}`,
          ref: ref || null,
          refType: ref ? 'commit' : null,
          filters: effectiveFilters,
          preset: preset || null,
          asName: asName || null,
          files: rawFiles
        });

        // Write lineage to .vlurp.jsonl at the rootDir level
        const lineageDir = rootDir ? resolve(rootDir) : process.cwd();
        const lineagePath = join(lineageDir, '.vlurp.jsonl');
        await appendLineage(lineagePath, lineageRecord);

        // Generate tree output
        const tree = await buildTreeString(targetPath);
        setTreeOutput(tree);

        setResult({
          user: parsed.user,
          repo: parsed.repo,
          path: targetPath,
          filterCount: effectiveFilters.length,
          fileCount,
          detectedPatterns,
          ref: ref || null,
          asName: asName || null,
          unpinned: !ref,
          lineagePath
        });
        setStatus('complete');
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    }

    performFetch();
  }, [source, rootDir, filters, force, auto, dryRun, ref, asName, preset, quiet]);

  if (status === 'error') {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, { color: 'red' }, `Error: ${error}`)
    );
  }

  if (status === 'dry-run') {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(
        Text,
        { color: 'yellow', bold: true },
        `Dry run - would fetch ${result.user}/${result.repo}`
      ),
      result.ref && React.createElement(Text, { color: 'green' }, `  Pinned: ${result.ref}`),
      !result.ref &&
        React.createElement(Text, { color: 'yellow' }, '  Warning: not pinned (mutable upstream)'),
      result.asName && React.createElement(Text, { color: 'cyan' }, `  As: ${result.asName}`),
      React.createElement(Text, { color: 'gray' }, `  Target: ${result.path}`),
      result.detectedPatterns?.length > 0 &&
        React.createElement(
          Text,
          { color: 'cyan' },
          `  Auto-detected: ${result.detectedPatterns.join(', ')}`
        ),
      React.createElement(
        Text,
        { color: 'gray' },
        `  Filters: ${result.filters.slice(0, 5).join(', ')}${result.filters.length > 5 ? '...' : ''}`
      ),
      React.createElement(
        Text,
        { color: 'gray', marginTop: 1 },
        '\nRun without --dry-run to execute.'
      )
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
      React.createElement(Text, { color: 'green' }, `vlurped ${result.user}/${result.repo}`),
      result.ref && React.createElement(Text, { color: 'green' }, `  Pinned: ${result.ref}`),
      result.unpinned &&
        React.createElement(Text, { color: 'yellow' }, '  Warning: not pinned (mutable upstream)'),
      React.createElement(Text, { color: 'gray' }, `  Location: ${result.path}`),
      React.createElement(Text, { color: 'gray' }, `  Lineage: ${result.lineagePath}`),
      result.detectedPatterns?.length > 0 &&
        React.createElement(
          Text,
          { color: 'cyan' },
          `  Auto-detected: ${result.detectedPatterns.join(', ')}`
        ),
      result.filterCount > 0 &&
        React.createElement(
          Text,
          { color: 'gray' },
          `  Filters: ${result.filterCount} pattern(s) applied`
        ),
      treeOutput &&
        !quiet &&
        React.createElement(Box, { marginTop: 1 }, React.createElement(Text, null, treeOutput)),
      React.createElement(
        Text,
        { color: 'cyan', marginTop: 1 },
        `vlurped ${result.fileCount} files to ${result.path}`
      )
    );
  }

  return React.createElement(
    Box,
    null,
    React.createElement(Text, null, React.createElement(Spinner, { type: 'dots' })),
    React.createElement(
      Text,
      null,
      ` ${status === 'locating' ? 'Locating repository...' : 'vlurping repository...'}`
    )
  );
}

export function resolveTargetPath(user, repo, rootDir, asName) {
  // If --as is provided, use that as the directory name
  if (asName) {
    if (rootDir) {
      return resolve(rootDir, asName);
    }

    return resolve(process.cwd(), asName);
  }

  const userRepoPath = join(user, repo);

  if (rootDir) {
    return resolve(rootDir, userRepoPath);
  }

  return resolve(process.cwd(), userRepoPath);
}
