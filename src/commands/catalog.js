import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React, { useEffect, useState } from 'react';
import { buildCatalog } from '../catalog.js';

export function CatalogCommand({ targetPath, outputFile }) {
  const [status, setStatus] = useState('cataloging');
  const [error, setError] = useState(null);
  const [catalog, setCatalog] = useState(null);

  useEffect(() => {
    async function run() {
      try {
        const resolvedPath = resolve(targetPath);
        const catalogData = await buildCatalog(resolvedPath);

        // Write catalog.json
        const outPath = outputFile || join(resolvedPath, 'catalog.json');
        await writeFile(outPath, `${JSON.stringify(catalogData, null, 2)}\n`);

        setCatalog({ data: catalogData, path: outPath });
        setStatus('complete');
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    }

    run();
  }, [targetPath, outputFile]);

  if (status === 'error') {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, { color: 'red' }, `Error: ${error}`)
    );
  }

  if (status === 'cataloging') {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, null, React.createElement(Spinner, { type: 'dots' })),
      React.createElement(Text, null, ' Building catalog...')
    );
  }

  const skillCount = Object.keys(catalog.data.skills).length;

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(
      Text,
      { color: 'green', bold: true },
      `Catalog: ${skillCount} skill${skillCount === 1 ? '' : 's'} indexed`
    ),
    React.createElement(Text, null, ''),
    ...Object.entries(catalog.data.skills).map(([name, skill]) =>
      React.createElement(
        Text,
        { key: name, color: 'gray' },
        `  ${name.padEnd(30)} ${skill.source}${skill.ref ? ` @${skill.ref}` : ''}`
      )
    ),
    React.createElement(Text, null, ''),
    React.createElement(Text, { color: 'gray' }, `Written to ${catalog.path}`)
  );
}
