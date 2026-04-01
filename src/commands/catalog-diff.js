import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React, { useEffect, useState } from 'react';
import { diffCatalogs, formatCatalogDiff } from '../catalog-diff.js';

export function CatalogDiffCommand({ oldPath, newPath, json }) {
  const [status, setStatus] = useState('diffing');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    async function performDiff() {
      try {
        const resolvedOld = resolve(oldPath || 'catalog.prev.json');
        const resolvedNew = resolve(newPath || 'catalog.json');

        let oldCatalog;
        let newCatalog;

        try {
          const oldContent = await readFile(resolvedOld, 'utf8');
          oldCatalog = JSON.parse(oldContent);
        } catch {
          setError(`Could not read old catalog: ${resolvedOld}`);
          setStatus('error');
          return;
        }

        try {
          const newContent = await readFile(resolvedNew, 'utf8');
          newCatalog = JSON.parse(newContent);
        } catch {
          setError(`Could not read new catalog: ${resolvedNew}`);
          setStatus('error');
          return;
        }

        const diff = diffCatalogs(oldCatalog, newCatalog);
        setResult({ diff, oldPath: resolvedOld, newPath: resolvedNew });
        setStatus('complete');
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    }

    performDiff();
  }, [oldPath, newPath]);

  if (status === 'error') {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, { color: 'red' }, `Error: ${error}`)
    );
  }

  if (status === 'diffing') {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, null, React.createElement(Spinner, { type: 'dots' })),
      React.createElement(Text, null, ' Comparing catalogs...')
    );
  }

  // JSON output
  if (json) {
    return React.createElement(Text, null, JSON.stringify(result.diff, null, 2));
  }

  // Human-readable output
  const formatted = formatCatalogDiff(result.diff);
  const s = result.diff.summary;
  const hasChanges = s.new > 0 || s.removed > 0 || s.changed > 0;

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(Text, null, formatted),
    !hasChanges &&
      React.createElement(Text, { color: 'green', marginTop: 1 }, 'No changes between catalogs.')
  );
}
