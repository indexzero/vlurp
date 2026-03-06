import process from 'node:process';
import {jack} from 'jackspeak';
import {render} from 'ink';
import React from 'react';
import {FetchCommand} from './commands/fetch.js';
import {BatchCommand} from './commands/batch.js';
import {VerifyCommand} from './commands/verify.js';
import {PinCommand} from './commands/pin.js';
import {OutdatedCommand} from './commands/outdated.js';
import {DiffCommand} from './commands/diff.js';
import {ScanCommand} from './commands/scan.js';
import {CatalogCommand} from './commands/catalog.js';
import {PRESETS} from './presets.js';

const j = jack({
  usage: 'vlurp [command] [source] [options]'
})
  .description('A fun CLI tool to quickly fetch GitHub repositories and gists')
  .opt({
    d: {
      description: 'Root directory for vlurping',
      short: 'd'
    },
    preset: {
      description: 'Use a preset filter configuration (claude, skills, agents, docs, all-md, minimal)',
      hint: 'name'
    },
    ref: {
      description: 'Pin fetch to a specific git ref (commit SHA, tag, or branch)',
      hint: 'sha|tag|branch'
    },
    as: {
      description: 'Override output directory name (flatten path structure)',
      hint: 'name'
    }
  })
  .optList({
    filter: {
      description: 'Glob patterns to filter files (see defaults in help)',
      default: ['.claude/**', 'CLAUDE.md', '*.md', '**/*.md', '!README.md', '!CONTRIBUTING.md', '!LICENSE.md', '!CHANGELOG.md', '!CODE_OF_CONDUCT.md', 'agents/**', 'commands/**']
    }
  })
  .flag({
    help: {
      description: 'Show this help message',
      short: 'h'
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
      description: 'Force overwrite existing directories without prompting',
      short: 'f'
    }
  });

const {values, positionals} = j.parse();

if (values.help) {
  console.log(`vlurp - A fun CLI tool to quickly fetch GitHub repositories and gists

Commands:
  vlurp <source>          Fetch a single repository
  vlurp batch <file>      Process a .vlurpfile
  vlurp verify <path>     Verify file integrity against lineage records
  vlurp pin [source]      Pin unpinned sources to current upstream HEAD
  vlurp outdated [file]   Check for upstream changes
  vlurp diff <source>     Show content diff against upstream
  vlurp scan <path>       Analyze content for injection/escalation patterns
  vlurp catalog <path>    Generate catalog.json of indexed skills

Usage:
  vlurp <user>/<repo>                           Fetch to ./<user>/<repo>
  vlurp <user>/<repo> --ref <sha>               Fetch pinned to commit
  vlurp <user>/<repo> --as <name> -d ./skills   Fetch to ./skills/<name>
  vlurp <url> -d <root>                         Fetch to <root>/<user>/<repo>
  vlurp batch <vlurpfile>                       Process batch file
  vlurp verify ./skills                         Check files against .vlurp.jsonl
  vlurp pin                                     Pin all unpinned in .vlurpfile
  vlurp outdated .vlurpfile                     Check what has changed upstream
  vlurp diff user/repo -d ./skills              Show diff against upstream

Presets:
${Object.entries(PRESETS).map(([name, config]) =>
  `  ${name.padEnd(10)} ${config.description}`).join('\n')}

Examples:
  vlurp user/repo --ref abc1234           Fetch pinned to commit
  vlurp user/repo --as myskill -d ./sk    Fetch to ./sk/myskill
  vlurp user/repo --preset claude         Use claude preset filters
  vlurp user/repo --auto                  Auto-detect structure
  vlurp batch .vlurpfile                  Process batch file
  vlurp batch .vlurpfile --dry-run        Preview batch operations
  vlurp verify skills/                    Verify integrity
  vlurp pin                               Pin all sources
  vlurp outdated .vlurpfile               Check upstream
  vlurp diff user/repo -d ./skills        Content diff
  vlurp scan skills/                      Scan for threats
  vlurp catalog skills/                   Build catalog

.vlurpfile Format:
  # Comments start with #
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
const {force, auto, preset, quiet} = values;
const {ref} = values;
const asName = values.as;
const dryRun = values['dry-run'];

// Handle subcommands
switch (command) {
  case 'batch': {
    const vlurpfile = positionals[1];
    if (!vlurpfile) {
      console.error('Error: batch command requires a .vlurpfile path');
      console.error('Usage: vlurp batch <vlurpfile>');
      process.exit(1);
    }

    render(React.createElement(BatchCommand, {
      vlurpfile, dryRun, force, quiet
    }));

    break;
  }

  case 'verify': {
    const targetPath = positionals[1] || '.';
    render(React.createElement(VerifyCommand, {targetPath}));

    break;
  }

  case 'pin': {
    const source = positionals[1] || null;
    const vlurpfilePath = positionals[2] || null;
    render(React.createElement(PinCommand, {source, vlurpfilePath}));

    break;
  }

  case 'outdated': {
    const vlurpfileArg = positionals[1] || null;
    render(React.createElement(OutdatedCommand, {vlurpfilePath: vlurpfileArg}));

    break;
  }

  case 'scan': {
    const scanPath = positionals[1] || '.';
    render(React.createElement(ScanCommand, {targetPath: scanPath}));

    break;
  }

  case 'catalog': {
    const catalogPath = positionals[1] || '.';
    render(React.createElement(CatalogCommand, {targetPath: catalogPath}));

    break;
  }

  case 'diff': {
    const diffSource = positionals[1];
    if (!diffSource) {
      console.error('Error: diff command requires a source');
      console.error('Usage: vlurp diff <user/repo> [-d <root>]');
      process.exit(1);
    }

    render(React.createElement(DiffCommand, {source: diffSource, rootDir}));

    break;
  }

  default: {
  // Regular fetch command
    const source = command;

    // Resolve filters from preset or explicit filters
    let filters = values.filter;
    if (preset && PRESETS[preset]) {
      filters = PRESETS[preset].filters;
    }

    render(React.createElement(FetchCommand, {
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
    }));
  }
}
