import { jack } from 'jackspeak';
import { render } from 'ink';
import React from 'react';
import { CloneCommand } from './commands/clone.js';

const j = jack({
  usage: 'vlurp [source] [options]',
})
  .description('A fun CLI tool to quickly clone GitHub repositories and gists')
  .opt({
    d: {
      description: 'Root directory for cloning',
      short: 'd',
    },
  })
  .optList({
    filter: {
      description: 'Glob patterns to filter files (defaults to .claude/** and CLAUDE.md)',
      short: 'f',
      default: ['.claude/**', 'CLAUDE.md'],
    },
  })
  .flag({
    help: {
      description: 'Show this help message',
      short: 'h',
    },
  });

const { values, positionals } = j.parse();

if (values.help) {
  console.log(`vlurp - A fun CLI tool to quickly clone GitHub repositories and gists

Usage:
  vlurp <user>/<repo>                    Clone to ./<user>/<repo>
  vlurp <user>/<repo> -d <root>         Clone to <root>/<user>/<repo>
  vlurp <url>                           Clone GitHub/Gist URL to ./<user>/<repo>
  vlurp <url> -d <root>                 Clone to <root>/<user>/<repo>

Examples:
  vlurp facebook/react                   Clone with default filters (.claude/**, CLAUDE.md)
  vlurp nodejs/node --filter "*.js"      Clone only JavaScript files
  vlurp user/repo -f "src/**" -f "*.md"  Clone src folder and markdown files

Options:
${j.usage()}`);
  process.exit(0);
}

if (positionals.length === 0) {
  console.log(j.usage());
  process.exit(1);
}

const source = positionals[0];
const rootDir = values.d;
const filters = values.filter;

render(React.createElement(CloneCommand, { source, rootDir, filters }));
