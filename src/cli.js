import process from 'node:process';
import {jack} from 'jackspeak';
import {render} from 'ink';
import React from 'react';
import {FetchCommand} from './commands/fetch.js';
import {BatchCommand} from './commands/batch.js';
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

Usage:
  vlurp <user>/<repo>                    Fetch to ./<user>/<repo>
  vlurp <user>/<repo> -d <root>          Fetch to <root>/<user>/<repo>
  vlurp <url>                            Fetch GitHub/Gist URL to ./<user>/<repo>
  vlurp <url> -d <root>                  Fetch to <root>/<user>/<repo>
  vlurp batch <vlurpfile>                Process batch file
  vlurp batch <vlurpfile> --dry-run      Preview batch operations

Presets:
${Object.entries(PRESETS).map(([name, config]) =>
  `  ${name.padEnd(10)} ${config.description}`).join('\n')}

Examples:
  vlurp facebook/react                   Fetch with default filters
  vlurp nodejs/node --filter "*.js"      Fetch only JavaScript files
  vlurp user/repo --filter "src/**"      Fetch src folder
  vlurp user/repo --force                Force overwrite existing directory
  vlurp user/repo --preset claude        Use claude preset filters
  vlurp user/repo --preset skills        Use skills preset filters
  vlurp user/repo --auto                 Auto-detect structure
  vlurp batch .vlurpfile                 Process batch file
  vlurp batch .vlurpfile --dry-run       Preview batch operations

.vlurpfile Format:
  # Comments start with #
  vlurp user/repo -d ./vlurp
  vlurp user/repo -d ./vlurp --filter "claude/**"
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
const dryRun = values['dry-run'];

// Handle subcommands
if (command === 'batch') {
  const vlurpfile = positionals[1];
  if (!vlurpfile) {
    console.error('Error: batch command requires a .vlurpfile path');
    console.error('Usage: vlurp batch <vlurpfile>');
    process.exit(1);
  }

  render(React.createElement(BatchCommand, {
    vlurpfile, dryRun, force, quiet
  }));
} else {
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
    quiet
  }));
}
