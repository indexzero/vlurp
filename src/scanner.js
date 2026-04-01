import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

/**
 * Known prompt injection patterns.
 */
const INJECTION_PATTERNS = [
  {
    pattern: /ignore\s+(all\s+)?previous\s+instructions/i,
    label: 'Prompt override: "ignore previous instructions"'
  },
  { pattern: /you\s+are\s+now\s+/i, label: 'Prompt override: "you are now"' },
  { pattern: /new\s+instructions?\s*:/i, label: 'Prompt override: "new instructions:"' },
  { pattern: /system\s+prompt\s*:/i, label: 'Prompt override: "system prompt:"' },
  { pattern: /forget\s+(everything|all|your)\s/i, label: 'Prompt override: "forget everything"' },
  {
    pattern: /disregard\s+(all\s+)?(previous|prior|above)/i,
    label: 'Prompt override: "disregard previous"'
  }
];

/**
 * Tool references to detect.
 */
const TOOL_PATTERNS = [
  { pattern: /\bBash\b/, label: 'Bash' },
  { pattern: /\bRead\b(?=\s+tool|\s+to\s+read)/, label: 'Read' },
  { pattern: /\bWrite\b(?=\s+tool|\s+to\s+write)/, label: 'Write' },
  { pattern: /\bEdit\b(?=\s+tool|\s+to\s+edit)/, label: 'Edit' },
  { pattern: /\bWebFetch\b/, label: 'WebFetch' },
  { pattern: /\bWebSearch\b/, label: 'WebSearch' }
];

/**
 * Exfiltration patterns.
 */
const EXFILTRATION_PATTERNS = [
  { pattern: /curl\s+.*?-d\s/i, label: 'curl POST data' },
  { pattern: /curl\s+.*?--data/i, label: 'curl POST data' },
  { pattern: /wget\s+.*?--post/i, label: 'wget POST' },
  { pattern: /fetch\s*\(.*?method\s*:\s*['"]post/i, label: 'fetch POST' },
  { pattern: /\.env\b/i, label: 'References .env file' },
  { pattern: /credentials?\.(json|yml|yaml|toml)/i, label: 'References credentials file' },
  { pattern: /api[_-]?key/i, label: 'References API key' },
  { pattern: /send\s+(file|content|data)\s+to\s/i, label: 'Instruction to send data externally' }
];

/**
 * Persistence patterns.
 */
const PERSISTENCE_PATTERNS = [
  { pattern: /claude\.md/i, label: 'References CLAUDE.md' },
  { pattern: /\.claude\/(settings|config)/i, label: 'References .claude config' },
  { pattern: /\.cursor\//i, label: 'References .cursor config' },
  { pattern: /add\s+(this\s+)?to\s+(your\s+)?claude/i, label: 'Instruction to modify CLAUDE.md' },
  { pattern: /cron(tab)?\s/i, label: 'References cron/scheduled tasks' },
  {
    pattern: /install\s+(additional|more)\s+(tools|skills|plugins)/i,
    label: 'Instruction to install additional tools'
  }
];

/**
 * Tool escalation patterns.
 */
const ESCALATION_PATTERNS = [
  { pattern: /curl\s+.*?\|\s*sh/i, label: 'curl | sh (remote code execution)' },
  { pattern: /curl\s+.*?\|\s*bash/i, label: 'curl | bash (remote code execution)' },
  { pattern: /wget\s+.*?-o\s*-\s*\|\s*(sh|bash)/i, label: 'wget pipe to shell' },
  { pattern: /npx\s+(?!--)/i, label: 'npx execution' },
  { pattern: /git\s+push\s+--force/i, label: 'git push --force' },
  { pattern: /git\s+reset\s+--hard/i, label: 'git reset --hard' },
  { pattern: /rm\s+-rf\s+\//i, label: 'rm -rf / (destructive)' },
  { pattern: /--no-verify/i, label: 'Skip hooks (--no-verify)' },
  { pattern: /chmod\s+[0-7]*7[0-7]*\s/i, label: 'chmod world-executable' }
];

/**
 * Command references to detect (common external commands in skills).
 */
const COMMAND_PATTERN = /```(?:bash|sh|shell|zsh)?\n([\s\S]*?)```/g;
const COMMAND_EXTRACT = /^\s*([a-z][\w.-]*)\s/gm;

/**
 * Scan a single file and return findings.
 */
export function scanFileContent(content, filePath) {
  const findings = {
    file: filePath,
    injection: [],
    tools: {},
    exfiltration: [],
    persistence: [],
    escalation: [],
    commands: new Set()
  };

  // Check injection patterns
  for (const { pattern, label } of INJECTION_PATTERNS) {
    const matches = content.match(new RegExp(pattern, 'gi'));
    if (matches) {
      findings.injection.push({ label, count: matches.length });
    }
  }

  // Check tool references
  for (const { pattern, label } of TOOL_PATTERNS) {
    const matches = content.match(new RegExp(pattern, 'g'));
    if (matches) {
      findings.tools[label] = matches.length;
    }
  }

  // Check exfiltration patterns
  for (const { pattern, label } of EXFILTRATION_PATTERNS) {
    if (pattern.test(content)) {
      findings.exfiltration.push(label);
    }
  }

  // Check persistence patterns
  for (const { pattern, label } of PERSISTENCE_PATTERNS) {
    if (pattern.test(content)) {
      findings.persistence.push(label);
    }
  }

  // Check escalation patterns
  for (const { pattern, label } of ESCALATION_PATTERNS) {
    if (pattern.test(content)) {
      findings.escalation.push(label);
    }
  }

  // Extract command references from code blocks
  let codeMatch;
  COMMAND_PATTERN.lastIndex = 0;
  while ((codeMatch = COMMAND_PATTERN.exec(content)) !== null) {
    const codeBlock = codeMatch[1];
    let cmdMatch;
    COMMAND_EXTRACT.lastIndex = 0;
    while ((cmdMatch = COMMAND_EXTRACT.exec(codeBlock)) !== null) {
      const cmd = cmdMatch[1];
      // Skip very common shell builtins and noise
      if (
        ![
          'echo',
          'cd',
          'export',
          'set',
          'if',
          'then',
          'else',
          'fi',
          'do',
          'done',
          'for',
          'while',
          'case',
          'esac'
        ].includes(cmd)
      ) {
        findings.commands.add(cmd);
      }
    }
  }

  return findings;
}

/**
 * Scan a directory of files and produce a report.
 */
export async function scanDirectory(dirPath) {
  const results = [];
  const textExtensions = new Set([
    '.md',
    '.txt',
    '.yml',
    '.yaml',
    '.json',
    '.toml',
    '.sh',
    '.bash',
    '.js',
    '.ts',
    '.py'
  ]);

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (
        textExtensions.has(extname(entry.name).toLowerCase()) ||
        entry.name === 'SKILL.md' ||
        entry.name === 'CLAUDE.md'
      ) {
        const relPath = relative(dirPath, fullPath);
        const content = await readFile(fullPath, 'utf8');
        results.push(scanFileContent(content, relPath));
      }
    }
  }

  await walk(dirPath);
  return results;
}

/**
 * Summarize scan results into a report object.
 */
export function summarizeScan(fileResults) {
  let totalIssues = 0;
  let totalWarnings = 0;
  const allTools = {};
  const allCommands = new Set();
  const injectionPatterns = [];
  const exfiltrationPatterns = [];

  for (const result of fileResults) {
    // Injection = issue
    totalIssues += result.injection.length;

    // Exfiltration and escalation = issue
    totalIssues += result.exfiltration.length;
    totalIssues += result.escalation.length;

    // Tools and persistence = warning
    totalWarnings += Object.keys(result.tools).length;
    totalWarnings += result.persistence.length;

    // Aggregate tools
    for (const [tool, count] of Object.entries(result.tools)) {
      allTools[tool] = (allTools[tool] || 0) + count;
    }

    // Aggregate commands
    for (const cmd of result.commands) {
      allCommands.add(cmd);
    }

    // Collect patterns
    for (const inj of result.injection) {
      injectionPatterns.push({ file: result.file, ...inj });
    }

    for (const exf of result.exfiltration) {
      exfiltrationPatterns.push({ file: result.file, label: exf });
    }
  }

  return {
    files_scanned: fileResults.length,
    issues: totalIssues,
    warnings: totalWarnings,
    tool_surface: Object.keys(allTools),
    command_surface: [...allCommands],
    injection_patterns: injectionPatterns,
    exfiltration_patterns: exfiltrationPatterns,
    details: Object.fromEntries(
      fileResults.map(r => [
        r.file,
        {
          tool_refs: r.tools,
          command_refs: [...r.commands],
          injection: r.injection,
          exfiltration: r.exfiltration,
          persistence: r.persistence,
          escalation: r.escalation
        }
      ])
    )
  };
}
