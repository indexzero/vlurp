import {join, basename} from 'node:path';
import {readFile} from 'node:fs/promises';
import {readLineage} from './lineage.js';
import {scanDirectory, summarizeScan} from './scanner.js';

/**
 * Build a catalog from content on disk.
 * Returns the catalog data object (does not write to disk).
 */
export async function buildCatalog(resolvedPath) {
  const lineagePath = join(resolvedPath, '.vlurp.jsonl');
  const records = await readLineage(lineagePath);

  const scanResults = await scanDirectory(resolvedPath);
  const scanSummary = summarizeScan(scanResults);

  const skills = {};

  for (const record of records) {
    const sourceId = record.source.replace(/^github:/, '');
    const prefix = record.as || sourceId;

    for (const filePath of Object.keys(record.files || {})) {
      if (basename(filePath) !== 'SKILL.md') {
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const skillEntry = await buildSkillEntry(resolvedPath, record, prefix, {filePath, scanSummary});
      if (skillEntry) {
        skills[skillEntry.name] = skillEntry.data;
      }
    }
  }

  return {
    generated_at: new Date().toISOString(), // eslint-disable-line camelcase
    skills
  };
}

async function buildSkillEntry(resolvedPath, record, prefix, {filePath, scanSummary}) {
  const skillDir = filePath === 'SKILL.md' ? prefix : join(prefix, filePath.replace(/\/SKILL\.md$/, ''));
  const skillName = basename(skillDir);
  const fullSkillPath = join(resolvedPath, prefix, filePath);

  let description = '';
  let frontmatter = null;

  try {
    const content = await readFile(fullSkillPath, 'utf8');
    frontmatter = extractFrontmatter(content);
    description = frontmatter?.description || extractFirstParagraph(content);
  } catch {
    // File might not exist
  }

  const supportingFiles = Object.keys(record.files)
    .filter(f => f !== filePath && f.startsWith(filePath.replace(/SKILL\.md$/, '')))
    .map(f => basename(f));

  const scanKey = join(prefix, filePath);
  const fileScan = scanSummary.details[scanKey] || {};

  return {
    name: skillName,
    data: {
      source: record.source,
      ref: record.ref,
      path: join(prefix, filePath),
      name: frontmatter?.name || skillName,
      version: frontmatter?.version || null,
      description,
      /* eslint-disable camelcase -- SPEC.3 JSON schema */
      tool_surface: Object.keys(fileScan.tool_refs || {}),
      command_surface: fileScan.command_refs || [],
      supporting_files: supportingFiles,
      /* eslint-enable camelcase */
      fetched_at: record.fetched_at // eslint-disable-line camelcase
    }
  };
}

/**
 * Extract YAML frontmatter from markdown content.
 */
export function extractFrontmatter(content) {
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
export function extractFirstParagraph(content) {
  // Skip frontmatter
  let text = content.replace(/^---[\s\S]*?---\n*/, '');
  // Skip headings
  text = text.replaceAll(/^#+\s+.*\n*/gm, '');
  // Get first non-empty line
  const line = text.split('\n').find(l => l.trim());
  return line?.trim().slice(0, 200) || '';
}
