import {resolve, join, basename} from 'node:path';
import {readFile, writeFile} from 'node:fs/promises';
import React, {useState, useEffect} from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {readLineage} from '../lineage.js';
import {scanDirectory, summarizeScan} from '../scanner.js';

export function CatalogCommand({targetPath, outputFile}) {
  const [status, setStatus] = useState('cataloging');
  const [error, setError] = useState(null);
  const [catalog, setCatalog] = useState(null);

  useEffect(() => {
    async function buildCatalog() {
      try {
        const resolvedPath = resolve(targetPath);
        const lineagePath = join(resolvedPath, '.vlurp.jsonl');
        const records = await readLineage(lineagePath);

        // Scan the directory
        const scanResults = await scanDirectory(resolvedPath);
        const scanSummary = summarizeScan(scanResults);

        // Build skills map from lineage records and scanned content
        const skills = {};

        for (const record of records) {
          const sourceId = record.source.replace(/^github:/, '');
          const prefix = record.as || sourceId;

          // Find SKILL.md files in the record
          for (const filePath of Object.keys(record.files || {})) {
            if (basename(filePath) === 'SKILL.md') {
              const skillDir = filePath === 'SKILL.md' ? prefix : join(prefix, filePath.replace(/\/SKILL\.md$/, ''));
              const skillName = basename(skillDir);
              const fullSkillPath = join(resolvedPath, prefix, filePath);

              let description = '';
              let frontmatter = null;

              try {
                // eslint-disable-next-line no-await-in-loop
                const content = await readFile(fullSkillPath, 'utf8');
                frontmatter = extractFrontmatter(content);
                description = frontmatter?.description || extractFirstParagraph(content);
              } catch {
                // File might not exist
              }

              // Find supporting files in the same skill directory
              const supportingFiles = Object.keys(record.files)
                .filter(f => f !== filePath && f.startsWith(filePath.replace(/SKILL\.md$/, '')))
                .map(f => basename(f));

              // Get scan details for this file
              const scanKey = join(prefix, filePath);
              const fileScan = scanSummary.details[scanKey] || {};

              skills[skillName] = {
                source: record.source,
                ref: record.ref,
                path: join(prefix, filePath),
                name: frontmatter?.name || skillName,
                description,
                /* eslint-disable camelcase -- SPEC.3 JSON schema */
                tool_surface: Object.keys(fileScan.tool_refs || {}),
                command_surface: fileScan.command_refs || [],
                supporting_files: supportingFiles,
                /* eslint-enable camelcase */
                fetched_at: record.fetched_at // eslint-disable-line camelcase
              };
            }
          }
        }

        const catalogData = {
          generated_at: new Date().toISOString(), // eslint-disable-line camelcase
          skills
        };

        // Write catalog.json
        const outPath = outputFile || join(resolvedPath, 'catalog.json');
        await writeFile(outPath, JSON.stringify(catalogData, null, 2) + '\n');

        setCatalog({data: catalogData, path: outPath});
        setStatus('complete');
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    }

    buildCatalog();
  }, [targetPath, outputFile]);

  if (status === 'error') {
    return React.createElement(
      Box,
      {flexDirection: 'column'},
      React.createElement(Text, {color: 'red'}, `Error: ${error}`)
    );
  }

  if (status === 'cataloging') {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, null, React.createElement(Spinner, {type: 'dots'})),
      React.createElement(Text, null, ' Building catalog...')
    );
  }

  const skillCount = Object.keys(catalog.data.skills).length;

  return React.createElement(
    Box,
    {flexDirection: 'column'},
    React.createElement(
      Text,
      {color: 'green', bold: true},
      `Catalog: ${skillCount} skill${skillCount === 1 ? '' : 's'} indexed`
    ),
    React.createElement(Text, null, ''),
    ...Object.entries(catalog.data.skills).map(([name, skill]) =>
      React.createElement(
        Text,
        {key: name, color: 'gray'},
        `  ${name.padEnd(30)} ${skill.source}${skill.ref ? ` @${skill.ref}` : ''}`
      )),
    React.createElement(Text, null, ''),
    React.createElement(Text, {color: 'gray'}, `Written to ${catalog.path}`)
  );
}

/**
 * Extract YAML frontmatter from markdown content.
 */
function extractFrontmatter(content) {
  const match = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!match) {
    return null;
  }

  const yaml = match[1];
  const result = {};

  for (const line of yaml.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim().replaceAll(/^["']|["']$/g, '');
      result[key] = value;
    }
  }

  return result;
}

/**
 * Extract the first meaningful paragraph from markdown.
 */
function extractFirstParagraph(content) {
  // Skip frontmatter
  let text = content.replace(/^---[\s\S]*?---\n*/, '');
  // Skip headings
  text = text.replaceAll(/^#+\s+.*\n*/gm, '');
  // Get first non-empty line
  const line = text.split('\n').find(l => l.trim());
  return line?.trim().slice(0, 200) || '';
}
