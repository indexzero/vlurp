import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import React, {useState, useEffect} from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {parseVlurpfile} from '../vlurpfile.js';
import {parseSource, fetchRepository} from '../remote.js';

export function BatchCommand({vlurpfile, dryRun, force, quiet: _quiet}) {
  const [status, setStatus] = useState('parsing');
  const [error, setError] = useState(null);
  const [entries, setEntries] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [results, setResults] = useState([]);

  useEffect(() => {
    async function processBatch() {
      try {
        // Read and parse vlurpfile
        setStatus('parsing');
        const vlurpfilePath = resolve(vlurpfile);
        const content = await readFile(vlurpfilePath, 'utf8');
        const parsed = parseVlurpfile(content);

        setEntries(parsed);

        if (dryRun) {
          setStatus('dry-run');
          const dryResults = parsed.map(entry => {
            try {
              const parsedSource = parseSource(entry.source);
              const targetPath = entry.targetPath || resolve(entry.rootDir || '.', parsedSource.user, parsedSource.repo);
              return {
                ...entry,
                status: 'would-fetch',
                targetPath,
                message: `Would fetch ${parsedSource.user}/${parsedSource.repo} to ${targetPath}`
              };
            } catch {
              return {
                ...entry,
                status: 'error',
                message: `Invalid source: ${entry.source}`
              };
            }
          });
          setResults(dryResults);
          return;
        }

        // Process each entry
        setStatus('fetching');
        const batchResults = [];

        for (const [i, entry] of parsed.entries()) {
          setCurrentIndex(i);

          try {
            const parsedSource = parseSource(entry.source);
            const targetPath = entry.targetPath || resolve(entry.rootDir || '.', parsedSource.user, parsedSource.repo);

            // eslint-disable-next-line no-await-in-loop -- Sequential batch processing is intentional
            await fetchRepository(
              parsedSource.tarballUrl,
              targetPath,
              entry.filters,
              {force: force || entry.force}
            );

            batchResults.push({
              ...entry,
              status: 'success',
              targetPath,
              message: `✓ ${parsedSource.user}/${parsedSource.repo}`
            });
          } catch (err) {
            batchResults.push({
              ...entry,
              status: 'error',
              message: `✗ ${entry.source}: ${err.message}`
            });
          }

          setResults([...batchResults]);
        }

        setStatus('complete');
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    }

    processBatch();
  }, [vlurpfile, dryRun, force]);

  if (status === 'error') {
    return React.createElement(
      Box,
      {flexDirection: 'column'},
      React.createElement(Text, {color: 'red'}, `✗ Error: ${error}`)
    );
  }

  if (status === 'parsing') {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, null, React.createElement(Spinner, {type: 'dots'})),
      React.createElement(Text, null, ' Parsing .vlurpfile...')
    );
  }

  if (status === 'dry-run') {
    return React.createElement(
      Box,
      {flexDirection: 'column'},
      React.createElement(Text, {color: 'yellow', bold: true}, `📋 Dry run - would process ${results.length} entries:\n`),
      ...results.map((result, i) =>
        React.createElement(
          Box,
          {key: i, flexDirection: 'column', marginBottom: 1},
          React.createElement(
            Text,
            {color: result.status === 'error' ? 'red' : 'gray'},
            `  ${i + 1}. ${result.source}`
          ),
          result.targetPath && React.createElement(
            Text,
            {color: 'cyan'},
            `     → ${result.targetPath}`
          ),
          result.filters?.length > 0 && React.createElement(
            Text,
            {color: 'gray', dimColor: true},
            `     filters: ${result.filters.slice(0, 3).join(', ')}${result.filters.length > 3 ? '...' : ''}`
          )
        )),
      React.createElement(Text, {color: 'gray', marginTop: 1}, '\nRun without --dry-run to execute.')
    );
  }

  if (status === 'fetching') {
    const completed = results.length;
    const total = entries.length;
    const current = entries[currentIndex];

    return React.createElement(
      Box,
      {flexDirection: 'column'},
      React.createElement(
        Box,
        null,
        React.createElement(Text, null, React.createElement(Spinner, {type: 'dots'})),
        React.createElement(Text, null, ` [${completed + 1}/${total}] Fetching ${current?.source}...`)
      ),
      results.length > 0 && React.createElement(Box, {marginTop: 1}),
      ...results.slice(-5).map((result, i) =>
        React.createElement(
          Text,
          {key: i, color: result.status === 'success' ? 'green' : 'red'},
          `  ${result.message}`
        ))
    );
  }

  // Complete status
  const successCount = results.filter(r => r.status === 'success').length;
  const errorCount = results.filter(r => r.status === 'error').length;

  return React.createElement(
    Box,
    {flexDirection: 'column'},
    React.createElement(
      Text,
      {color: errorCount > 0 ? 'yellow' : 'green', bold: true},
      `✨ Batch complete: ${successCount} succeeded${errorCount > 0 ? `, ${errorCount} failed` : ''}`
    ),
    React.createElement(Text, null, ''),
    ...results.map((result, i) =>
      React.createElement(
        Text,
        {key: i, color: result.status === 'success' ? 'green' : 'red'},
        `  ${result.message}`
      ))
  );
}
