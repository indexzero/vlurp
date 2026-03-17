import process from 'node:process';
import {readFile, writeFile, rename} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import React, {useState, useEffect} from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {parseVlurpfile, updateRefs} from '../vlurpfile.js';
import {parseSource, fetchRepository, Fetcher} from '../remote.js';
import {hashDirectory, createLineageRecord, appendLineage} from '../lineage.js';
import {buildCatalog} from '../catalog.js';
import {diffCatalogs, formatCatalogDiff} from '../catalog-diff.js';

export function UpgradeCommand({vlurpfilePath, source, dryRun}) {
  const [status, setStatus] = useState('resolving');
  const [error, setError] = useState(null);
  const [results, setResults] = useState([]);
  const [currentSource, setCurrentSource] = useState(null);
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    async function performUpgrade() {
      try {
        await runUpgrade({
          vlurpfilePath, source, dryRun,
          setStatus, setError, setResults, setCurrentSource, setSummary
        });
      } catch (err) {
        setError(err.message);
        setStatus('error');
      }
    }

    performUpgrade();
  }, [vlurpfilePath, source, dryRun]);

  if (status === 'error') {
    return React.createElement(
      Box,
      {flexDirection: 'column'},
      React.createElement(Text, {color: 'red'}, `Error: ${error}`)
    );
  }

  if (status === 'resolving' || status === 'checking') {
    return React.createElement(
      Box,
      null,
      React.createElement(Text, null, React.createElement(Spinner, {type: 'dots'})),
      React.createElement(Text, null, currentSource
        ? ` Checking ${currentSource}...`
        : ' Reading vlurpfile...')
    );
  }

  if (status === 'upgrading' || status === 'cataloging') {
    return renderUpgrading(currentSource, results, status);
  }

  if (status === 'dry-run-complete' && summary) {
    return renderDryRunComplete(summary);
  }

  if (status === 'complete' && summary) {
    return renderComplete(summary);
  }

  return null;
}

async function runUpgrade(options) {
  const {
    vlurpfilePath, source, dryRun,
    setStatus, setError, setResults, setCurrentSource, setSummary
  } = options;

  // Step 1: Find and read vlurpfile
  const filePath = await findVlurpfile(vlurpfilePath);
  if (!filePath) {
    setError('No .vlurpfile found. Specify a path with: vlurp upgrade --vlurpfile <file>');
    setStatus('error');
    return;
  }

  const content = await readFile(filePath, 'utf8');
  const entries = parseVlurpfile(content);

  if (entries.length === 0) {
    setError('No entries found in vlurpfile');
    setStatus('error');
    return;
  }

  // Filter to specific source if given
  const targetEntries = source
    ? entries.filter(e => e.source === source)
    : entries;

  if (source && targetEntries.length === 0) {
    setError(`Source "${source}" not found in vlurpfile`);
    setStatus('error');
    return;
  }

  // Deduplicate by source
  const sourceMap = new Map();
  for (const entry of targetEntries) {
    if (!sourceMap.has(entry.source)) {
      sourceMap.set(entry.source, []);
    }

    sourceMap.get(entry.source).push(entry);
  }

  // Step 2: Check upstream
  setStatus('checking');
  const fetcher = new Fetcher();
  const upgradeResults = await checkAndUpgradeSources({
    sourceMap, fetcher, dryRun, entries,
    setCurrentSource, setResults, setStatus
  });

  // Step 5: Rewrite .vlurpfile with new refs
  if (!dryRun) {
    const refUpdates = {};
    for (const r of upgradeResults) {
      if (r.status === 'upgraded') {
        refUpdates[r.source] = r.newRef;
      }
    }

    if (Object.keys(refUpdates).length > 0) {
      const updatedContent = updateRefs(content, refUpdates);
      await writeFile(filePath, updatedContent);
    }
  }

  // Build summary
  setSummary({
    upgraded: upgradeResults.filter(r => r.status === 'upgraded'),
    current: upgradeResults.filter(r => r.status === 'current'),
    outdated: upgradeResults.filter(r => r.status === 'outdated'),
    errors: upgradeResults.filter(r => r.status === 'error'),
    catalogDiff: upgradeResults[0]?.catalogDiff || null
  });
  setStatus(dryRun ? 'dry-run-complete' : 'complete');
}

async function checkAndUpgradeSources(options) {
  const {
    sourceMap, fetcher, dryRun, entries,
    setCurrentSource, setResults, setStatus
  } = options;
  const upgradeResults = [];

  // Collect rootDirs for catalog snapshot
  const rootDirs = collectRootDirs(entries);

  for (const [src, srcEntries] of sourceMap) {
    setCurrentSource(src);
    const parts = src.split('/');
    if (parts.length < 2) {
      upgradeResults.push({source: src, status: 'error', message: 'Invalid source format'});
      setResults([...upgradeResults]);
      continue;
    }

    const [user, repo] = parts;

    // eslint-disable-next-line no-await-in-loop -- Sequential for API rate limits
    const upstreamSha = await fetcher.resolveHead(user, repo);
    if (!upstreamSha) {
      upgradeResults.push({source: src, status: 'error', message: 'Could not resolve upstream HEAD'});
      setResults([...upgradeResults]);
      continue;
    }

    const pinnedRef = srcEntries[0].ref;
    const isCurrent = pinnedRef
      && (upstreamSha.startsWith(pinnedRef) || pinnedRef.startsWith(upstreamSha.slice(0, pinnedRef.length)));

    if (isCurrent) {
      upgradeResults.push({
        source: src, status: 'current',
        ref: pinnedRef, upstream: upstreamSha.slice(0, 7)
      });
      setResults([...upgradeResults]);
      continue;
    }

    if (dryRun) {
      upgradeResults.push({
        source: src, status: 'outdated',
        ref: pinnedRef || null, upstream: upstreamSha.slice(0, 7),
        entries: srcEntries.length
      });
      setResults([...upgradeResults]);
      continue;
    }

    // Step 3: Snapshot pre-upgrade catalog (once, before first fetch)
    // eslint-disable-next-line no-await-in-loop
    const preCatalog = await snapshotCatalogs(rootDirs, setStatus, setCurrentSource);

    // Fetch each entry for this source with the new ref
    setStatus('upgrading');
    const shortSha = upstreamSha.slice(0, 7);
    // eslint-disable-next-line no-await-in-loop
    const fetchedAll = await fetchSourceEntries(srcEntries, upstreamSha, setCurrentSource);

    // Step 4: Snapshot post-upgrade catalog and diff
    // eslint-disable-next-line no-await-in-loop
    const postCatalog = await snapshotCatalogs(rootDirs, setStatus, setCurrentSource);
    const catalogDiff = diffCatalogs(preCatalog, postCatalog);

    // Save catalog.prev.json and catalog.json
    // eslint-disable-next-line no-await-in-loop
    await saveCatalogs(rootDirs, preCatalog, postCatalog);

    upgradeResults.push({
      source: src,
      status: fetchedAll ? 'upgraded' : 'error',
      ref: pinnedRef || null,
      upstream: shortSha,
      newRef: shortSha,
      entries: srcEntries.length,
      message: fetchedAll ? null : 'One or more entries failed to fetch',
      catalogDiff
    });
    setResults([...upgradeResults]);
  }

  return upgradeResults;
}

function collectRootDirs(entries) {
  const dirs = new Set();
  for (const entry of entries) {
    dirs.add(entry.rootDir ? resolve(entry.rootDir) : process.cwd());
  }

  return [...dirs];
}

async function snapshotCatalogs(rootDirs, setStatus, setCurrentSource) {
  setStatus('cataloging');
  setCurrentSource('building catalog...');

  // Merge catalogs from all rootDirs into one
  const merged = {skills: {}};
  for (const dir of rootDirs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const catalog = await buildCatalog(dir);
      Object.assign(merged.skills, catalog.skills);
    } catch {
      // Directory might not have lineage yet
    }
  }

  return merged;
}

async function saveCatalogs(rootDirs, preCatalog, postCatalog) {
  for (const dir of rootDirs) {
    const catalogPath = join(dir, 'catalog.json');
    const prevPath = join(dir, 'catalog.prev.json');

    // Rotate existing catalog.json to catalog.prev.json
    try {
      // eslint-disable-next-line no-await-in-loop
      await rename(catalogPath, prevPath);
    } catch {
      // No existing catalog.json — write prev from snapshot
      try {
        // eslint-disable-next-line no-await-in-loop
        await writeFile(prevPath, JSON.stringify(preCatalog, null, 2) + '\n');
      } catch {
        // Write failure is non-fatal
      }
    }

    // Write new catalog.json
    try {
      // eslint-disable-next-line no-await-in-loop
      await writeFile(catalogPath, JSON.stringify(postCatalog, null, 2) + '\n');
    } catch {
      // Write failure is non-fatal
    }
  }
}

async function fetchSourceEntries(srcEntries, upstreamSha, setCurrentSource) {
  let fetchedAll = true;

  for (const entry of srcEntries) {
    setCurrentSource(`${entry.source}${entry.as ? ` (${entry.as})` : ''}`);
    try {
      const parsed = parseSource(entry.source, {ref: upstreamSha});
      const targetPath = entry.targetPath || resolve(entry.rootDir || '.', parsed.user, parsed.repo);

      // eslint-disable-next-line no-await-in-loop
      await fetchRepository(parsed.tarballUrl, targetPath, entry.filters, {force: true});

      // eslint-disable-next-line no-await-in-loop
      const files = await hashDirectory(targetPath);
      const lineageRecord = createLineageRecord({
        source: `${parsed.user}/${parsed.repo}`,
        ref: upstreamSha,
        refType: 'commit',
        filters: entry.filters,
        preset: entry.preset || null,
        asName: entry.as || null,
        files
      });

      const lineageDir = entry.rootDir ? resolve(entry.rootDir) : process.cwd();
      const lineagePath = join(lineageDir, '.vlurp.jsonl');
      // eslint-disable-next-line no-await-in-loop
      await appendLineage(lineagePath, lineageRecord);
    } catch {
      fetchedAll = false;
    }
  }

  return fetchedAll;
}

function renderUpgrading(currentSource, results, status) {
  const label = status === 'cataloging' ? 'Building catalog...' : `Upgrading ${currentSource}...`;
  return React.createElement(
    Box,
    {flexDirection: 'column'},
    React.createElement(
      Box,
      null,
      React.createElement(Text, null, React.createElement(Spinner, {type: 'dots'})),
      React.createElement(Text, null, ` ${label}`)
    ),
    ...results.filter(r => r.status !== 'current').slice(-5).map((r, i) =>
      React.createElement(
        Text,
        {key: i, color: r.status === 'upgraded' ? 'green' : (r.status === 'error' ? 'red' : 'yellow')},
        `  ${statusIcon(r.status)} ${r.source} ${r.ref || ''} -> ${r.upstream || r.newRef || ''}`
      ))
  );
}

function renderDryRunComplete(summary) {
  const {outdated, current, errors} = summary;
  const hasChanges = outdated.length > 0;

  return React.createElement(
    Box,
    {flexDirection: 'column'},
    React.createElement(Text, {color: 'yellow', bold: true}, 'Dry run — would upgrade:\n'),
    ...outdated.map(r => React.createElement(
      Text,
      {key: r.source, color: 'yellow'},
      `  ${r.source}  ${r.ref || '(unpinned)'} -> ${r.upstream}${r.entries > 1 ? ` (${r.entries} entries)` : ''}`
    )),
    ...current.map(r => React.createElement(
      Text,
      {key: r.source, color: 'green'},
      `  ${r.source}  ${r.ref}  up to date`
    )),
    ...errors.map(r => React.createElement(
      Text,
      {key: r.source, color: 'red'},
      `  ${r.source}  ${r.message}`
    )),
    React.createElement(Text, null, ''),
    React.createElement(
      Text,
      {bold: true, color: hasChanges ? 'yellow' : 'green'},
      `${outdated.length} to upgrade, ${current.length} current${errors.length > 0 ? `, ${errors.length} errors` : ''}`
    ),
    hasChanges && React.createElement(Text, {color: 'gray', marginTop: 1}, '\nRun without --dry-run to apply.')
  );
}

function renderComplete(summary) {
  const {upgraded, current, errors, catalogDiff} = summary;

  const elements = [
    ...upgraded.map(r => React.createElement(
      Text,
      {key: r.source, color: 'green'},
      `  ${r.source}  ${r.ref || '(unpinned)'} -> ${r.newRef}${r.entries > 1 ? ` (${r.entries} entries)` : ''}`
    )),
    ...current.map(r => React.createElement(
      Text,
      {key: r.source, color: 'green'},
      `  ${r.source}  ${r.ref}  up to date`
    )),
    ...errors.map(r => React.createElement(
      Text,
      {key: r.source, color: 'red'},
      `  ${r.source}  ${r.message}`
    )),
    React.createElement(Text, {key: '_blank1'}, ''),
    React.createElement(
      Text,
      {key: '_summary', bold: true, color: errors.length > 0 ? 'yellow' : 'green'},
      `${upgraded.length} upgraded, ${current.length} current${errors.length > 0 ? `, ${errors.length} errors` : ''}`
    )
  ];

  // Append catalog diff if available and has changes
  const hasSkillChanges = catalogDiff
    && (catalogDiff.summary.new > 0 || catalogDiff.summary.removed > 0 || catalogDiff.summary.changed > 0);
  if (hasSkillChanges) {
    const diffElements = [
      React.createElement(Text, {key: '_blank2'}, ''),
      React.createElement(Text, {key: '_diffheader', bold: true}, 'What changed:'),
      React.createElement(Text, {key: '_diff'}, formatCatalogDiff(catalogDiff))
    ];
    elements.push(...diffElements);
  }

  if (upgraded.length > 0) {
    elements.push(React.createElement(Text, {key: '_refs', color: 'gray'}, '  .vlurpfile updated with new refs'));
  }

  return React.createElement(
    Box,
    {flexDirection: 'column'},
    ...elements
  );
}

function statusIcon(s) {
  switch (s) {
    case 'upgraded': {
      return 'ok';
    }

    case 'current': {
      return 'ok';
    }

    case 'outdated': {
      return '--';
    }

    case 'error': {
      return 'ERR';
    }

    default: {
      return '??';
    }
  }
}

async function findVlurpfile(explicitPath) {
  if (explicitPath) {
    return resolve(explicitPath);
  }

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
