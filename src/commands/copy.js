import process from 'node:process';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React, { useEffect, useState } from 'react';
import { copySources } from '../copy-sources.js';

export function CopyCommand({ sources, destination, force, dryRun, quiet, globs, iglobs, preset }) {
  const [status, setStatus] = useState('copying');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    async function performCopy() {
      try {
        const copyResult = await copySources({
          sources,
          destination,
          force,
          dryRun,
          globs,
          iglobs,
          preset
        });
        setResult(copyResult);
        setStatus(copyResult.status);
      } catch (copyError) {
        process.exitCode = 1;
        setError(copyError.message);
        setStatus('error');
      }
    }

    performCopy();
  }, [sources, destination, force, dryRun, globs, iglobs, preset]);

  if (status === 'error') {
    return React.createElement(Text, { color: 'red' }, `Error: ${error}`);
  }

  if (status === 'cancelled') {
    return React.createElement(Text, { color: 'yellow' }, 'vlurping cancelled.');
  }

  if (status === 'dry-run') {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, { color: 'yellow', bold: true }, 'Dry run - would copy:'),
      ...result.plan.entries.map(entry =>
        React.createElement(
          Text,
          { key: `${entry.source.raw}:${entry.relativePath}`, color: 'gray' },
          `  ${entry.source.raw} -> ${entry.targetPath}`
        )
      )
    );
  }

  if (status === 'complete') {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(
        Text,
        { color: 'green' },
        `vlurped ${result.fileCount} file(s) to ${result.plan.destinationPath}`
      ),
      ...(!quiet
        ? result.plan.entries.map(entry =>
            React.createElement(
              Text,
              { key: entry.targetPath, color: 'gray' },
              `  ${entry.targetPath}`
            )
          )
        : [])
    );
  }

  return React.createElement(
    Box,
    null,
    React.createElement(Text, null, React.createElement(Spinner, { type: 'dots' })),
    React.createElement(Text, null, ' Resolving remote sources...')
  );
}
