import {resolve} from 'node:path';
import {readFile, writeFile} from 'node:fs/promises';
import React, {useState, useEffect} from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {Fetcher} from '../remote.js';
import {parseVlurpfile} from '../vlurpfile.js';

export function PinCommand({source, vlurpfilePath}) {
  const [status, setStatus] = useState('resolving');
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);

  useEffect(() => {
    async function performPin() {
      try {
        // Find the vlurpfile
        const filePath = await findVlurpfile(vlurpfilePath);
        if (!filePath) {
          setError('No .vlurpfile found. Specify a path or create one.');
          setStatus('error');
          return;
        }

        const content = await readFile(filePath, 'utf8');
        const entries = parseVlurpfile(content);
        const fetcher = new Fetcher();
        const pinResults = [];

        // Filter to specific source if provided
        const toPin = source
          ? entries.filter(e => e.source === source || e.source.includes(source))
          : entries.filter(e => !e.ref);

        if (toPin.length === 0) {
          if (source) {
            setError(`No matching unpinned entry for "${source}" in ${filePath}`);
          } else {
            setError(`All entries in ${filePath} are already pinned`);
          }

          setStatus('error');
          return;
        }

        let updatedContent = content;

        for (const entry of toPin) {
          const parts = entry.source.split('/');
          if (parts.length < 2) {
            pinResults.push({source: entry.source, status: 'error', message: 'Invalid source format'});
            continue;
          }

          const [user, repo] = parts;

          // eslint-disable-next-line no-await-in-loop
          const sha = await fetcher.resolveHead(user, repo);
          if (!sha) {
            pinResults.push({source: entry.source, status: 'error', message: 'Could not resolve HEAD'});
            continue;
          }

          const shortSha = sha.slice(0, 7);

          // Update the vlurpfile content — find the line with this source and add --ref
          const sourcePattern = new RegExp(
            `(vlurp\\s+${escapeRegex(entry.source)}(?:\\s+[^\\n]*?)?)(?:\\s*(?:#.*)?)$`,
            'gm'
          );

          updatedContent = updatedContent.replace(sourcePattern, (match, command) => {
            // Don't add ref if already pinned
            if (command.includes('--ref ')) {
              return match;
            }

            const comment = match.slice(command.length);
            return `${command} --ref ${shortSha}${comment}`;
          });

          pinResults.push({source: entry.source, status: 'pinned', sha: shortSha});
          setResults([...pinResults]);
        }

        // Write updated vlurpfile
        await writeFile(filePath, updatedContent);

        setResults(pinResults);
        setStatus('complete');
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    }

    performPin();
  }, [source, vlurpfilePath]);

  if (status === 'error') {
    return React.createElement(
      Box,
      {flexDirection: 'column'},
      React.createElement(Text, {color: 'red'}, `Error: ${error}`)
    );
  }

  if (status === 'resolving') {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, null, React.createElement(Spinner, {type: 'dots'})),
      React.createElement(Text, null, ' Resolving upstream HEAD...')
    );
  }

  const pinned = results.filter(r => r.status === 'pinned');
  const errors = results.filter(r => r.status === 'error');

  return React.createElement(
    Box,
    {flexDirection: 'column'},
    React.createElement(Text, {bold: true}, 'Pin results:'),
    React.createElement(Text, null, ''),
    ...pinned.map(r => React.createElement(
      Text,
      {key: r.source, color: 'green'},
      `  ${r.source} -> ${r.sha}`
    )),
    ...errors.map(r => React.createElement(
      Text,
      {key: r.source, color: 'red'},
      `  ${r.source}: ${r.message}`
    )),
    React.createElement(Text, null, ''),
    React.createElement(
      Text,
      {color: errors.length > 0 ? 'yellow' : 'green'},
      `${pinned.length} pinned${errors.length > 0 ? `, ${errors.length} failed` : ''}`
    )
  );
}

async function findVlurpfile(explicitPath) {
  if (explicitPath) {
    return resolve(explicitPath);
  }

  // Search for common vlurpfile names
  const candidates = ['.vlurpfile', '.vlurpfile.skills'];
  for (const name of candidates) {
    try {
      const path = resolve(name);
      // eslint-disable-next-line no-await-in-loop
      await readFile(path);
      return path;
    } catch {
      // Continue
    }
  }

  return null;
}

function escapeRegex(string) {
  return string.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}
