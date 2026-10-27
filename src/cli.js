import { readFileSync } from 'node:fs';
import process from 'node:process';
import { render } from 'ink';
import { jack } from 'jackspeak';
import React from 'react';
import { BatchCommand } from './commands/batch.js';
import { CatalogCommand } from './commands/catalog.js';
import { CatalogDiffCommand } from './commands/catalog-diff.js';
import { CopyCommand } from './commands/copy.js';
import { DiffCommand } from './commands/diff.js';
import { FetchCommand } from './commands/fetch.js';
import { OutdatedCommand } from './commands/outdated.js';
import { PinCommand } from './commands/pin.js';
import { RestoreCommand } from './commands/restore.js';
import { ScanCommand } from './commands/scan.js';
import { UpgradeCommand } from './commands/upgrade.js';
import { VerifyCommand } from './commands/verify.js';
import { isPathLikeOperand, readLocalFileOperand } from './local-file.js';
import { PRESETS } from './presets.js';

const DEFAULT_FILTERS = [
  '.claude/**',
  'CLAUDE.md',
  '*.md',
  '**/*.md',
  '!README.md',
  '!CONTRIBUTING.md',
  '!LICENSE.md',
  '!CHANGELOG.md',
  '!CODE_OF_CONDUCT.md',
  'agents/**',
  'commands/**'
];

const j = jack({
  usage:
    'vlurp REPOSITORY [options]\n       vlurp SOURCE... DEST [options]\n       vlurp ./path/.vlurpfile | ./path/.vlurp.jsonl [options]\n       vlurp COMMAND [arguments] [options]'
})
  .description('A fun CLI tool to quickly fetch GitHub repositories and gists')
  .opt({
    d: {
      description: 'Root directory for vlurping',
      short: 'd'
    },
    preset: {
      description:
        'Use a preset filter configuration (claude, skills, agents, docs, all-md, minimal)',
      hint: 'name'
    },
    ref: {
      description: 'Pin fetch to a specific git ref (commit SHA, tag, or branch)',
      hint: 'sha|tag|branch'
    },
    as: {
      description: 'Override output directory name (flatten path structure)',
      hint: 'name'
    },
    vlurpfile: {
      description: 'Path to .vlurpfile (for upgrade command)',
      hint: 'path'
    }
  })
  .optList({
    filter: {
      description: 'Glob patterns to filter files in repository selection mode'
    },
    glob: {
      description: 'Case-sensitive transfer pattern; prefix with ! to exclude'
    },
    iglob: {
      description: 'Case-insensitive transfer pattern; prefix with ! to exclude'
    }
  })
  .flag({
    help: {
      description: 'Show this help message',
      short: 'h'
    },
    version: {
      description: 'Print the vlurp version',
      short: 'v'
    },
    auto: {
      description: 'Auto-detect repository structure and apply appropriate filters',
      short: 'a'
    },
    'dry-run': {
      description: 'Preview what would be fetched without actually fetching',
      short: 'n'
    },
    quiet: {
      description: 'Suppress non-essential output',
      short: 'q'
    },
    force: {
      description:
        'Overwrite existing files without prompting (restore: replace locally modified files)',
      short: 'f'
    },
    json: {
      description: 'Output in JSON format (for catalog-diff)'
    }
  });

const { values, positionals } = j.parse();

if (values.version) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

if (values.help) {
  console.log(`vlurp - A fun CLI tool to quickly fetch GitHub repositories and gists

Commands:
  vlurp <repo> [options]     Fetch a repository using shorthand
  vlurp <source>... <dest>   Copy precise PURL sources with cp semantics
  vlurp ./path/.vlurpfile    Run every command in a .vlurpfile
  vlurp ./path/.vlurp.jsonl  Restore recorded files, enforcing every sha256
  vlurp upgrade [source]     Upgrade outdated sources to upstream HEAD
  vlurp verify <path>        Verify file integrity against lineage records
  vlurp pin [source]         Pin unpinned sources to current upstream HEAD
  vlurp outdated [file]      Check for upstream changes
  vlurp diff <source>        Show content diff against upstream
  vlurp scan <path>          Analyze content for injection/escalation patterns
  vlurp catalog <path>       Generate catalog.json of indexed skills
  vlurp catalog-diff         Compare two catalog snapshots

Usage:
  vlurp <owner>/<repository>                    Fetch useful text files
  vlurp <owner>/<repository> --preset <name>    Fetch using a named preset
  vlurp <owner>/<repository> --filter '<glob>'  Fetch repository-relative matches
  vlurp 'pkg:github/<owner>/<repo>#<path>' DEST Copy an exact remote path
  vlurp 'pkg:github/<owner>/<repo>#<glob>' DEST Select remote paths, then copy basenames
  vlurp 'pkg:github/<owner>/<repo>@<ref>#<path>' DEST Pin source in the PURL
  vlurp SOURCE SOURCE... DEST                   Copy multiple remote sources
  vlurp SOURCE DEST --glob '**/*.md'            Copy files matching a pattern
  vlurp SOURCE DEST --iglob '**/skill.md'       Match a pattern without case
  vlurp ./path/.vlurpfile                       Run a .vlurpfile
  vlurp ./path/.vlurp.jsonl                     Restore files recorded in lineage

Local files:
  A path operand (starting with ., /, or ~, or naming an existing file) is
  routed by its content. JSON lines restore from lineage; anything else runs
  as a .vlurpfile. Restore fetches each record's source, writes only the
  recorded paths, and writes nothing unless every sha256 matches. It skips
  files that already match, refuses locally modified files unless --force,
  and never rewrites .vlurp.jsonl.

Repository preset and filter mode:
  vlurp <user>/<repo>                           Fetch to ./<user>/<repo>
  vlurp <user>/<repo> --ref <sha>               Fetch pinned to commit
  vlurp <user>/<repo> --as <name> -d ./skills   Fetch to ./skills/<name>
  vlurp <url> -d <root>                         Fetch to <root>/<user>/<repo>
  vlurp upgrade                                 Upgrade all outdated sources
  vlurp upgrade user/repo                       Upgrade specific source
  vlurp verify ./skills                         Check files against .vlurp.jsonl
  vlurp pin                                     Pin all unpinned in .vlurpfile
  vlurp outdated .vlurpfile                     Check what has changed upstream
  vlurp diff user/repo -d ./skills              Show diff against upstream

Presets:
${Object.entries(PRESETS)
  .map(([name, config]) => `  ${name.padEnd(10)} ${config.description}`)
  .join('\n')}

Examples:
  vlurp mattpocock/skills --preset skills  Fetch using a maintained preset
  vlurp user/repo --ref abc1234           Fetch pinned to commit
  vlurp user/repo --as myskill -d ./sk    Fetch to ./sk/myskill
  vlurp user/repo --preset claude         Use claude preset filters
  vlurp user/repo --auto                  Auto-detect structure
  vlurp 'pkg:github/mattpocock/skills#skills/in-progress/writing-*' ./skills/
  vlurp 'pkg:github/anthropics/skills@main#skills/pdf' ./skills/
  vlurp 'pkg:github/mattpocock/skills#skills' ./skills/ --preset skills
  vlurp 'pkg:github/user/repo#docs' ./docs/ --glob '**/*.md' --glob '!README.md'
  vlurp ./.vlurpfile                      Run a .vlurpfile
  vlurp ./.vlurpfile --dry-run            Preview .vlurpfile operations
  vlurp ./skills/.vlurp.jsonl             Restore files from lineage
  vlurp ./skills/.vlurp.jsonl --dry-run   Preview a restore without network
  vlurp ./skills/.vlurp.jsonl --force     Replace locally modified files
  vlurp upgrade                           Upgrade all outdated
  vlurp upgrade user/repo                 Upgrade specific source
  vlurp upgrade --dry-run                 Preview upgrades
  vlurp verify skills/                    Verify integrity
  vlurp pin                               Pin all sources
  vlurp outdated .vlurpfile               Check upstream
  vlurp diff user/repo -d ./skills        Content diff
  vlurp scan skills/                      Scan for threats
  vlurp catalog skills/                   Build catalog
  vlurp catalog-diff                      Diff prev vs current catalog
  vlurp catalog-diff old.json new.json    Diff explicit catalogs
  vlurp catalog-diff --json               Machine-readable output

.vlurpfile Format:
  # Comments start with #
  vlurp 'pkg:github/user/repo@abc1234#skills/*' ./skills/
  vlurp pkg:github/user/repo ./docs/ --glob '**/*.md' --iglob '!**/draft-*'
  vlurp user/repo -d ./vlurp --ref abc1234
  vlurp user/repo -d ./vlurp --filter "claude/**" --as myname
  vlurp user/repo --preset skills

Options:
${j.usage()}`);
  process.exit(0);
}

if (positionals.length === 0) {
  console.log(j.usage());
  process.exit(1);
}

const command = positionals[0];
const rootDir = values.d;
const { force, auto, preset, quiet } = values;
const { ref } = values;
const asName = values.as;
const dryRun = values['dry-run'];

if (preset && !PRESETS[preset]) {
  console.error(
    `Error: unknown preset "${preset}"; choose one of: ${Object.keys(PRESETS).join(', ')}`
  );
  process.exit(1);
}

/**
 * Run a local file operand: lineage (.vlurp.jsonl) restores, anything else
 * runs as a .vlurpfile. The file's content decides, not its name.
 */
function runLocalFile(operand) {
  let local;
  try {
    local = readLocalFileOperand(operand);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  if (local.kind === 'lineage') {
    const unsupported = [
      rootDir && '-d',
      values.filter?.length > 0 && '--filter',
      ref && '--ref',
      asName && '--as',
      auto && '--auto',
      preset && '--preset',
      values.glob?.length > 0 && '--glob',
      values.iglob?.length > 0 && '--iglob'
    ].filter(Boolean);
    if (unsupported.length > 0) {
      console.error(
        `Error: ${unsupported.join(', ')} cannot be used when restoring from .vlurp.jsonl; each lineage record fixes its source, ref, and files`
      );
      process.exit(1);
    }

    render(React.createElement(RestoreCommand, { lineagePath: local.path, force, dryRun, quiet }));
    return;
  }

  render(
    React.createElement(BatchCommand, {
      vlurpfile: local.path,
      dryRun,
      force,
      quiet
    })
  );
}

// Handle subcommands
switch (command) {
  case 'verify': {
    const targetPath = positionals[1] || '.';
    render(React.createElement(VerifyCommand, { targetPath }));

    break;
  }

  case 'pin': {
    const source = positionals[1] || null;
    const vlurpfilePath = positionals[2] || null;
    render(React.createElement(PinCommand, { source, vlurpfilePath }));

    break;
  }

  case 'outdated': {
    const vlurpfileArg = positionals[1] || null;
    render(React.createElement(OutdatedCommand, { vlurpfilePath: vlurpfileArg }));

    break;
  }

  case 'upgrade': {
    const upgradeSource = positionals[1] || null;
    render(
      React.createElement(UpgradeCommand, {
        vlurpfilePath: values.vlurpfile || null,
        source: upgradeSource,
        dryRun
      })
    );

    break;
  }

  case 'scan': {
    const scanPath = positionals[1] || '.';
    render(React.createElement(ScanCommand, { targetPath: scanPath }));

    break;
  }

  case 'catalog': {
    const catalogPath = positionals[1] || '.';
    render(React.createElement(CatalogCommand, { targetPath: catalogPath }));

    break;
  }

  case 'catalog-diff': {
    const cdOldPath = positionals[1] || null;
    const cdNewPath = positionals[2] || null;
    render(
      React.createElement(CatalogDiffCommand, {
        oldPath: cdOldPath,
        newPath: cdNewPath,
        json: values.json
      })
    );

    break;
  }

  case 'diff': {
    const diffSource = positionals[1];
    if (!diffSource) {
      console.error('Error: diff command requires a source');
      console.error('Usage: vlurp diff <user/repo> [-d <root>]');
      process.exit(1);
    }

    render(React.createElement(DiffCommand, { source: diffSource, rootDir }));

    break;
  }

  default: {
    if (command.startsWith('pkg:')) {
      if (positionals.length < 2) {
        console.error('Error: cp-style invocation requires SOURCE and DEST operands');
        console.error("Usage: vlurp 'pkg:github/<owner>/<repo>#<subpath>' <dest>");
        process.exit(1);
      }

      const repositoryOptions = [
        rootDir && '-d',
        values.filter?.length > 0 && '--filter',
        ref && '--ref',
        asName && '--as',
        auto && '--auto'
      ].filter(Boolean);
      if (repositoryOptions.length > 0) {
        console.error(
          `Error: ${repositoryOptions.join(', ')} cannot be used with PURL sources; put remote selections in PURL operands and use --glob or --iglob for transfer patterns`
        );
        process.exit(1);
      }

      const sources = positionals.slice(0, -1);
      const destination = positionals.at(-1);
      render(
        React.createElement(CopyCommand, {
          sources,
          destination,
          force,
          dryRun,
          quiet,
          globs: values.glob || [],
          iglobs: values.iglob || [],
          preset
        })
      );
      break;
    }

    // Local files: GitHub owners cannot start with ".", "/", or "~", so a
    // path-like operand never shadows repository shorthand.
    if (isPathLikeOperand(command)) {
      if (positionals.length > 1) {
        console.error(
          `Error: expected a single .vlurpfile or .vlurp.jsonl path, got ${positionals.length} operands`
        );
        process.exit(1);
      }

      runLocalFile(command);
      break;
    }

    // Repository preset and filter mode
    const source = command;

    if (values.glob?.length > 0 || values.iglob?.length > 0) {
      console.error('Error: --glob and --iglob require cp-style PURL SOURCE... DEST operands');
      process.exit(1);
    }

    // Resolve filters from preset or explicit filters
    let filters = values.filter?.length > 0 ? values.filter : DEFAULT_FILTERS;
    if (preset && PRESETS[preset]) {
      filters = PRESETS[preset].filters;
    }

    render(
      React.createElement(FetchCommand, {
        source,
        rootDir,
        filters,
        force,
        auto,
        dryRun,
        quiet,
        ref,
        asName,
        preset
      })
    );
  }
}
