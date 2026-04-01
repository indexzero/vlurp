import { join, resolve } from 'node:path';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React, { useEffect, useState } from 'react';
import { readLineage } from '../lineage.js';
import { scanDirectory, summarizeScan } from '../scanner.js';

export function ScanCommand({ targetPath }) {
  const [status, setStatus] = useState('scanning');
  const [error, setError] = useState(null);
  const [fileResults, setFileResults] = useState(null);
  const [summary, setSummary] = useState(null);
  const [lineageInfo, setLineageInfo] = useState(null);

  useEffect(() => {
    async function performScan() {
      try {
        const resolvedPath = resolve(targetPath);

        // Try to read lineage for context
        const lineagePath = join(resolvedPath, '.vlurp.jsonl');
        const records = await readLineage(lineagePath);
        if (records.length > 0) {
          setLineageInfo(records);
        }

        const results = await scanDirectory(resolvedPath);
        const report = summarizeScan(results);

        setFileResults(results);
        setSummary(report);
        setStatus('complete');
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    }

    performScan();
  }, [targetPath]);

  if (status === 'error') {
    return React.createElement(
      Box,
      { flexDirection: 'column' },
      React.createElement(Text, { color: 'red' }, `Error: ${error}`)
    );
  }

  if (status === 'scanning') {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, null, React.createElement(Spinner, { type: 'dots' })),
      React.createElement(Text, null, ' Scanning content...')
    );
  }

  // Render results
  const elements = [];

  // Lineage context header
  if (lineageInfo) {
    for (const record of lineageInfo) {
      elements.push(
        React.createElement(
          Text,
          { key: `lineage-${record.source}`, color: 'gray' },
          `${record.source}${record.ref ? ` (pinned: ${record.ref})` : ' (not pinned)'}${record.fetched_at ? `, fetched: ${record.fetched_at.slice(0, 10)}` : ''}`
        )
      );
    }

    elements.push(React.createElement(Text, { key: 'spacer-lineage' }, ''));
  }

  // Per-file results
  for (const result of fileResults) {
    elements.push(
      React.createElement(Text, { key: `file-${result.file}`, bold: true }, `  ${result.file}`)
    );

    // Injection (high severity)
    if (result.injection.length > 0) {
      for (const inj of result.injection) {
        elements.push(
          React.createElement(
            Text,
            { key: `inj-${result.file}-${inj.label}`, color: 'red' },
            `    ISSUE ${inj.label} (${inj.count} instance${inj.count > 1 ? 's' : ''})`
          )
        );
      }
    } else {
      elements.push(
        React.createElement(
          Text,
          { key: `ok-inj-${result.file}`, color: 'green' },
          '    ok   No injection patterns detected'
        )
      );
    }

    // Exfiltration
    for (const exf of result.exfiltration) {
      elements.push(
        React.createElement(
          Text,
          { key: `exf-${result.file}-${exf}`, color: 'red' },
          `    ISSUE Exfiltration: ${exf}`
        )
      );
    }

    // Escalation
    for (const esc of result.escalation) {
      elements.push(
        React.createElement(
          Text,
          { key: `esc-${result.file}-${esc}`, color: 'red' },
          `    ISSUE Escalation: ${esc}`
        )
      );
    }

    // Tool references (warnings)
    for (const [tool, count] of Object.entries(result.tools)) {
      elements.push(
        React.createElement(
          Text,
          { key: `tool-${result.file}-${tool}`, color: 'yellow' },
          `    warn References ${tool} tool (${count} instance${count > 1 ? 's' : ''})`
        )
      );
    }

    // Persistence (warnings)
    for (const per of result.persistence) {
      elements.push(
        React.createElement(
          Text,
          { key: `per-${result.file}-${per}`, color: 'yellow' },
          `    warn Persistence: ${per}`
        )
      );
    }

    // Commands
    if (result.commands.size > 0) {
      elements.push(
        React.createElement(
          Text,
          { key: `cmd-${result.file}`, color: 'yellow' },
          `    warn References external commands: ${[...result.commands].join(', ')}`
        )
      );
    }
  }

  // Summary
  elements.push(
    React.createElement(Text, { key: 'spacer-summary' }, ''),
    React.createElement(
      Text,
      { key: 'summary', bold: true, color: summary.issues > 0 ? 'red' : 'green' },
      `Summary: ${summary.files_scanned} files, ${summary.issues} issues, ${summary.warnings} warnings`
    )
  );

  if (summary.tool_surface.length > 0) {
    elements.push(
      React.createElement(
        Text,
        { key: 'tools', color: 'gray' },
        `Tool surface: ${summary.tool_surface.join(', ')}`
      )
    );
  }

  if (summary.command_surface.length > 0) {
    elements.push(
      React.createElement(
        Text,
        { key: 'commands', color: 'gray' },
        `Command surface: ${summary.command_surface.join(', ')}`
      )
    );
  }

  return React.createElement(Box, { flexDirection: 'column' }, ...elements);
}
