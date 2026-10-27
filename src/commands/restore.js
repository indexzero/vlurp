import process from 'node:process';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React, { useEffect, useState } from 'react';
import { restoreLineage } from '../restore.js';

const DRY_RUN_LABELS = {
  fetch: ['fetch', 'cyan', '(missing)'],
  skip: ['unchanged', 'green', ''],
  overwrite: ['overwrite', 'yellow', '(modified; --force)'],
  refuse: ['modified', 'red', '(refused without --force)']
};

const COMPLETE_LABELS = {
  fetch: ['restored', 'green'],
  overwrite: ['overwritten', 'yellow'],
  skip: ['unchanged', 'gray']
};

export function RestoreCommand({ lineagePath, force, dryRun, quiet }) {
  const [status, setStatus] = useState('restoring');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    async function performRestore() {
      try {
        const restoreResult = await restoreLineage({ lineagePath, force, dryRun });
        if (restoreResult.files.some(file => file.action === 'refuse')) {
          process.exitCode = 1;
        }

        setResult(restoreResult);
        setStatus(restoreResult.status);
      } catch (restoreError) {
        process.exitCode = 1;
        setError(restoreError.message);
        setStatus('error');
      }
    }

    performRestore();
  }, [lineagePath, force, dryRun]);

  if (status === 'error') {
    return React.createElement(Text, { color: 'red' }, `Error: ${error}`);
  }

  if (status === 'restoring') {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, null, React.createElement(Spinner, { type: 'dots' })),
      React.createElement(Text, null, ` Restoring from ${lineagePath}...`)
    );
  }

  const warnings = result.warnings.map(warning =>
    React.createElement(Text, { key: warning, color: 'yellow' }, `Warning: ${warning}`)
  );

  if (status === 'dry-run') {
    const refused = result.files.filter(file => file.action === 'refuse').length;
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(
        Text,
        { color: 'yellow', bold: true },
        `Dry run - restore ${result.files.length} file(s) from ${result.lineagePath}:`
      ),
      ...warnings,
      ...result.files.map(file => {
        const [label, color, note] = DRY_RUN_LABELS[file.action];
        return React.createElement(
          Text,
          { key: file.path, color },
          `  ${label.padEnd(12)} ${file.path}${note ? ` ${note}` : ''}`
        );
      }),
      React.createElement(
        Text,
        { color: refused > 0 ? 'red' : 'gray' },
        refused > 0
          ? `${refused} locally modified file(s) would block the restore; re-run with --force to replace them.`
          : 'Run without --dry-run to restore.'
      )
    );
  }

  const written = result.files.filter(file => file.action !== 'skip').length;
  const unchanged = result.files.length - written;
  return React.createElement(
    Box,
    { flexDirection: 'column' },
    ...warnings,
    React.createElement(
      Text,
      { color: 'green' },
      written > 0
        ? `Restored ${written} file(s) from ${result.lineagePath}${unchanged > 0 ? ` (${unchanged} unchanged)` : ''}`
        : `All ${unchanged} recorded file(s) unchanged in ${result.root}`
    ),
    ...(!quiet
      ? result.files.map(file => {
          const [label, color] = COMPLETE_LABELS[file.action];
          return React.createElement(
            Text,
            { key: file.path, color },
            `  ${label.padEnd(12)} ${file.path}`
          );
        })
      : [])
  );
}
