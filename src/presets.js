/**
 * Preset filter configurations for common repository structures.
 * Each preset targets a specific type of "vibes" content.
 */
export const PRESETS = {
  claude: {
    description: 'Claude Code configuration (.claude/**, CLAUDE.md)',
    filters: [
      '.claude/**',
      'CLAUDE.md',
      '!README.md',
      '!LICENSE*',
      '!CONTRIBUTING.md',
      '!CODE_OF_CONDUCT*'
    ]
  },
  skills: {
    description: 'Agent skills (skills/**, SKILL.md)',
    filters: [
      'skills/**',
      'SKILL.md',
      '**/*.md',
      '!README.md',
      '!LICENSE*',
      '!CONTRIBUTING.md'
    ]
  },
  agents: {
    description: 'Agent definitions (agents/**, commands/**)',
    filters: [
      'agents/**',
      'commands/**',
      '**/*.md',
      '!README.md',
      '!LICENSE*'
    ]
  },
  docs: {
    description: 'Documentation only (**/*.md, excluding boilerplate)',
    filters: [
      '**/*.md',
      '!README.md',
      '!CONTRIBUTING.md',
      '!LICENSE*.md',
      '!CHANGELOG.md',
      '!CODE_OF_CONDUCT.md'
    ]
  },
  'all-md': {
    description: 'All markdown files (**/*.md)',
    filters: ['**/*.md']
  },
  minimal: {
    description: 'Minimal Claude config (.claude/**, CLAUDE.md only)',
    filters: ['.claude/**', 'CLAUDE.md']
  }
};
