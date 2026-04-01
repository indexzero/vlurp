import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React, { useEffect, useState } from 'react';
import { readLineage } from '../lineage.js';
import { fetchRepository, parseSource } from '../remote.js';

export function DiffCommand({ source, rootDir }) {
  const [status, setStatus] = useState('diffing');
  const [error, setError] = useState(null);
  const [diffOutput, setDiffOutput] = useState(null);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    async function performDiff() {
      const tempDir = join(tmpdir(), `vlurp-diff-${randomBytes(8).toString('hex')}`);

      try {
        // Parse the source
        const parsed = parseSource(source);
        const localDir = resolve(rootDir || '.', parsed.user, parsed.repo);

        // Read lineage to find the pinned ref and filters
        const lineageDir = rootDir ? resolve(rootDir) : process.cwd();
        const lineagePath = join(lineageDir, '.vlurp.jsonl');
        const records = await readLineage(lineagePath);
        const sourceKey = `github:${parsed.user}/${parsed.repo}`;
        const record = records.find(r => r.source === sourceKey);

        const filters = record?.filters || [];

        // Fetch upstream to temp directory
        setStatus('fetching upstream');
        await mkdir(tempDir, { recursive: true });
        const tempTarget = join(tempDir, 'upstream');
        await fetchRepository(parsed.tarballUrl, tempTarget, filters, { force: true });

        // Run diff between local and upstream
        setStatus('comparing');
        let diff = '';
        try {
          diff = execSync(`diff -rN --unified=3 "${localDir}" "${tempTarget}"`, {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024 * 10
          });
        } catch (err) {
          // Diff exits with code 1 when files differ — that's expected
          if (err.status === 1) {
            diff = err.stdout || '';
          } else if (err.status === 2) {
            throw new Error(`diff error: ${err.stderr}`);
          }
        }

        if (diff.trim()) {
          // Clean up temp paths from diff output for readability
          const cleanDiff = diff
            .replaceAll(localDir, `(local${record?.ref ? `, ${record.ref}` : ''})`)
            .replaceAll(tempTarget, '(upstream)');

          // Count changed files
          const fileChanges = (diff.match(/^diff /gm) || []).length;
          setSummary({
            changed: fileChanges,
            source: `${parsed.user}/${parsed.repo}`,
            ref: record?.ref
          });
          setDiffOutput(cleanDiff);
        } else {
          setSummary({ changed: 0, source: `${parsed.user}/${parsed.repo}`, ref: record?.ref });
          setDiffOutput('');
        }

        setStatus('complete');
      } catch (err) {
        setError(err.message);
        setStatus('error');
      } finally {
        // Clean up temp directory
        try {
          await rm(tempDir, { recursive: true, force: true });
        } catch {
          // Cleanup failure is non-fatal
        }
      }
    }

    performDiff();
  }, [source, rootDir]);

  if (status === 'error') {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, { color: 'red' }, `Error: ${error}`)
    );
  }

  if (status !== 'complete') {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, null, React.createElement(Spinner, { type: 'dots' })),
      React.createElement(
        Text,
        null,
        ` ${status === 'fetching upstream' ? 'Fetching upstream...' : 'Comparing...'}`
      )
    );
  }

  if (summary.changed === 0) {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(
        Text,
        { color: 'green' },
        `${summary.source}${summary.ref ? ` (pinned: ${summary.ref})` : ''}  No changes`
      )
    );
  }

  return React.createElement(
    Box,
    { flexDirection: 'column' },
    React.createElement(
      Text,
      { color: 'yellow', bold: true },
      `${summary.source}${summary.ref ? ` (pinned: ${summary.ref})` : ''}  ${summary.changed} file(s) differ`
    ),
    React.createElement(Text, null, ''),
    React.createElement(Text, null, diffOutput)
  );
}
