import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React, { useEffect, useState } from 'react';
import { readLineage } from '../lineage.js';
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

        // Try to read lineage for additional context
        const lineageRecords = [];
        for (const entry of entries) {
          if (entry.rootDir) {
            const lineagePath = join(resolve(entry.rootDir), '.vlurp.jsonl');
            try {
              const records = await readLineage(lineagePath);
              lineageRecords.push(...records);
            } catch {
              // No lineage file yet
            }
          }
        }

        const fetcher = new Fetcher();
        const outdatedResults = [];

        for (const entry of entries) {
          const parts = entry.source.split('/');
          if (parts.length < 2) {
            outdatedResults.push({
              source: entry.source,
              status: 'error',
              message: 'Invalid source format'
            });
            continue;
          }

          const [user, repo] = parts;

          const upstreamSha = await fetcher.resolveHead(user, repo);
          if (!upstreamSha) {
            outdatedResults.push({
              source: entry.source,
              status: 'error',
              message: 'Could not resolve upstream HEAD'
            });
            continue;
          }

          const shortUpstream = upstreamSha.slice(0, 7);

          if (!entry.ref) {
            outdatedResults.push({
              source: entry.source,
              status: 'unpinned',
              upstream: shortUpstream,
              message: 'Not pinned — always fetches latest'
            });
          } else if (
            upstreamSha.startsWith(entry.ref) ||
            entry.ref.startsWith(upstreamSha.slice(0, entry.ref.length))
          ) {
            // Compare short SHAs sensibly
            outdatedResults.push({
              source: entry.source,
              status: 'current',
              pinned: entry.ref,
              upstream: shortUpstream
            });
          } else {
            outdatedResults.push({
              source: entry.source,
              status: 'outdated',
              pinned: entry.ref,
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
