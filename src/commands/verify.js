import {resolve, join} from 'node:path';
import React, {useState, useEffect} from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {readLineage, verifyFiles} from '../lineage.js';

export function VerifyCommand({targetPath}) {
  const [status, setStatus] = useState('verifying');
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);

  useEffect(() => {
    async function performVerify() {
      try {
        const resolvedPath = resolve(targetPath);
        const jsonlPath = join(resolvedPath, '.vlurp.jsonl');

        const records = await readLineage(jsonlPath);
        if (records.length === 0) {
          setError(`No lineage records found at ${jsonlPath}`);
          setStatus('error');
          return;
        }

        const verifyResults = await verifyFiles(resolvedPath, records);
        setResults(verifyResults);
        setStatus('complete');
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    }

    performVerify();
  }, [targetPath]);

  if (status === 'error') {
    return React.createElement(
      Box,
      {flexDirection: 'column'},
      React.createElement(Text, {color: 'red'}, `Error: ${error}`)
    );
  }

  if (status === 'verifying') {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, null, React.createElement(Spinner, {type: 'dots'})),
      React.createElement(Text, null, ' Verifying file integrity...')
    );
  }

  const ok = results.filter(r => r.status === 'ok');
  const modified = results.filter(r => r.status === 'modified');
  const missing = results.filter(r => r.status === 'missing');
  const untracked = results.filter(r => r.status === 'untracked');
  const hasIssues = modified.length > 0 || missing.length > 0;

  return React.createElement(
    Box,
    {flexDirection: 'column'},
    React.createElement(
      Text,
      {bold: true},
      `Verify: ${resolve(targetPath)}`
    ),
    React.createElement(Text, null, ''),
    ...ok.map(r => React.createElement(
      Text,
      {key: r.file, color: 'green'},
      `  ${r.file.padEnd(50)} ok  (sha256: ${r.expected.slice(0, 8)}...)`
    )),
    ...modified.map(r => React.createElement(
      Text,
      {key: r.file, color: 'red'},
      `  ${r.file.padEnd(50)} MODIFIED  (expected: ${r.expected.slice(0, 8)}..., actual: ${r.actual.slice(0, 8)}...)`
    )),
    ...missing.map(r => React.createElement(
      Text,
      {key: r.file, color: 'red'},
      `  ${r.file.padEnd(50)} MISSING`
    )),
    ...untracked.map(r => React.createElement(
      Text,
      {key: r.file, color: 'gray'},
      `  ${r.file.padEnd(50)} no lineage (local file)`
    )),
    React.createElement(Text, null, ''),
    React.createElement(
      Text,
      {color: hasIssues ? 'red' : 'green', bold: true},
      hasIssues
        ? `${modified.length} modified, ${missing.length} missing, ${ok.length} ok, ${untracked.length} untracked`
        : `All ${ok.length} tracked files verified${untracked.length > 0 ? ` (${untracked.length} untracked)` : ''}`
    )
  );
}
