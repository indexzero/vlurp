import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React, { useEffect, useState } from 'react';
import { expandManifestSources } from '../manifest-sources.js';
import { Fetcher } from '../remote.js';
import { parseVlurpfile } from '../vlurpfile.js';

export function OutdatedCommand({ vlurpfilePath }) {
  const [status, setStatus] = useState('checking');
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);

  useEffect(() => {
    async function checkOutdated() {
      try {
        // Find and read vlurpfile
        const filePath = await findVlurpfile(vlurpfilePath);
        if (!filePath) {
          setError('No .vlurpfile found. Specify a path with: vlurp outdated <vlurpfile>');
          setStatus('error');
          return;
        }

        const content = await readFile(filePath, 'utf8');
        const entries = parseVlurpfile(content);

        if (entries.length === 0) {
          setError('No entries found in vlurpfile');
          setStatus('error');
          return;
        }

        const fetcher = new Fetcher();
        const outdatedResults = [];

        for (const source of expandManifestSources(entries)) {
          const upstreamSha = await fetcher.resolveHead(source.user, source.repo);
          if (!upstreamSha) {
            outdatedResults.push({
              source: source.raw,
              status: 'error',
              message: 'Could not resolve upstream HEAD'
            });
            continue;
          }

          const shortUpstream = upstreamSha.slice(0, 7);

          if (!source.ref) {
            outdatedResults.push({
              source: source.raw,
              status: 'unpinned',
              upstream: shortUpstream,
              message: 'Not pinned — always fetches latest'
            });
          } else if (
            upstreamSha.startsWith(source.ref) ||
            source.ref.startsWith(upstreamSha.slice(0, source.ref.length))
          ) {
            // Compare short SHAs sensibly
            outdatedResults.push({
              source: source.raw,
              status: 'current',
              pinned: source.ref,
              upstream: shortUpstream
            });
          } else {
            outdatedResults.push({
              source: source.raw,
              status: 'outdated',
              pinned: source.ref,
              upstream: shortUpstream
            });
          }

          setResults([...outdatedResults]);
        }

        setResults(outdatedResults);
        setStatus('complete');
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    }

    checkOutdated();
  }, [vlurpfilePath]);

  if (status === 'error') {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, { color: 'red' }, `Error: ${error}`)
    );
  }

  if (status === 'checking') {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, null, React.createElement(Spinner, { type: 'dots' })),
      React.createElement(Text, null, ' Checking upstream...')
    );
  }

  const current = results.filter(r => r.status === 'current');
  const outdated = results.filter(r => r.status === 'outdated');
  const unpinned = results.filter(r => r.status === 'unpinned');
  const errors = results.filter(r => r.status === 'error');

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    ...current.map(r =>
      React.createElement(
        Text,
        { key: r.source, color: 'green' },
        `  ${r.source} (pinned: ${r.pinned})  ok  Up to date`
      )
    ),
    ...outdated.map(r =>
      React.createElement(
        Text,
        { key: r.source, color: 'yellow' },
        `  ${r.source} (pinned: ${r.pinned}, upstream: ${r.upstream})  OUTDATED`
      )
    ),
    ...unpinned.map(r =>
      React.createElement(
        Text,
        { key: r.source, color: 'yellow' },
        `  ${r.source} (upstream: ${r.upstream})  NOT PINNED`
      )
    ),
    ...errors.map(r =>
      React.createElement(Text, { key: r.source, color: 'red' }, `  ${r.source}  ${r.message}`)
    ),
    React.createElement(Text, null, ''),
    React.createElement(
      Text,
      { bold: true, color: outdated.length > 0 || unpinned.length > 0 ? 'yellow' : 'green' },
      `${current.length} current, ${outdated.length} outdated, ${unpinned.length} unpinned${errors.length > 0 ? `, ${errors.length} errors` : ''}`
    )
  );
}

async function findVlurpfile(explicitPath) {
  if (explicitPath) {
    return resolve(explicitPath);
  }

  const candidates = ['.vlurpfile', '.vlurpfile.skills'];
  for (const name of candidates) {
    try {
      const path = resolve(name);
      await readFile(path);
      return path;
    } catch {
      // Continue
    }
  }

  return null;
}
