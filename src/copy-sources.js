import { join, relative } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import {
  createCopyPlan,
  executeCopyPlan,
  listCopiedFiles,
  selectRepositoryEntries
} from './copy-plan.js';
import { appendLineage, createCopyLineageRecord, hashFile } from './lineage.js';
import { Fetcher } from './remote.js';
import { parseSourceOperand, sourceRepositoryKey } from './source-operand.js';

export async function copySources({
  sources,
  destination,
  globs = [],
  iglobs = [],
  preset = null,
  force = false,
  dryRun = false,
  confirm = confirmOverwrite,
  fetcher = new Fetcher()
}) {
  const parsedSources = sources.map(parseSourceOperand);
  const materialized = new Map();

  try {
    const selections = [];
    for (const source of parsedSources) {
      const materializationKey = `${sourceRepositoryKey(source)}@${source.ref || 'HEAD'}`;
      let repository = materialized.get(materializationKey);
      if (!repository) {
        repository = await fetcher.materialize(source.tarballUrl);
        materialized.set(materializationKey, repository);
      }

      selections.push(...(await selectRepositoryEntries(repository.path, source)));
    }

    const plan = await createCopyPlan(selections, destination, { globs, iglobs, preset });
    const existing = plan.entries.filter(entry => entry.exists);
    if (!dryRun && existing.length > 0 && !force) {
      const accepted = await confirm(existing.map(entry => entry.targetPath));
      if (!accepted) {
        return { status: 'cancelled', plan, fileCount: 0, records: [] };
      }
    }

    if (dryRun) {
      return { status: 'dry-run', plan, fileCount: 0, records: [] };
    }

    await executeCopyPlan(plan);
    const records = [];
    for (const source of parsedSources) {
      const sourceEntries = plan.entries.filter(entry => entry.source === source);
      const sourcePlan = { ...plan, entries: sourceEntries };
      const copiedFiles = await listCopiedFiles(sourcePlan);
      const files = {};
      for (const file of copiedFiles) {
        files[file] = await hashFile(join(plan.lineageRoot, file));
      }

      const record = createCopyLineageRecord({
        source: source.raw,
        sourceKey: `${sourceRepositoryKey(source)}#${source.subpath}`,
        ref: source.ref,
        destination: relative(plan.lineageRoot, plan.destinationPath) || '.',
        globs,
        iglobs,
        preset,
        files
      });
      await appendLineage(join(plan.lineageRoot, '.vlurp.jsonl'), record);
      records.push(record);
    }

    return {
      status: 'complete',
      plan,
      fileCount: new Set(records.flatMap(record => Object.keys(record.files))).size,
      records
    };
  } finally {
    await Promise.all([...materialized.values()].map(repository => repository.cleanup()));
  }
}

async function confirmOverwrite(paths) {
  console.log(`\nWarning: ${paths.length} destination path(s) already exist.`);
  console.log('Continuing will overwrite matching files.');
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise(resolve => readline.question('Continue? (y/N): ', resolve));
  readline.close();
  return answer.toLowerCase() === 'y';
}
