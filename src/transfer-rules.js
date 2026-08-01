import { Minimatch } from 'minimatch';
import { PRESETS } from './presets.js';

export function compileTransferRules({ globs = [], iglobs = [], preset = null } = {}) {
  if (preset && !PRESETS[preset]) {
    throw new Error(`Unknown preset "${preset}"`);
  }

  const definitions = [
    ...(preset ? PRESETS[preset].filters.map(pattern => ({ pattern, nocase: false })) : []),
    ...globs.map(pattern => ({ pattern, nocase: false })),
    ...iglobs.map(pattern => ({ pattern, nocase: true }))
  ];
  const rules = definitions.map(compileRule);
  const defaultIncluded = !rules.some(rule => rule.include);

  return {
    active: rules.length > 0,
    globs: [...globs],
    iglobs: [...iglobs],
    preset,
    matches(path) {
      const normalized = path.replaceAll('\\', '/');
      let included = defaultIncluded;
      for (const rule of rules) {
        if (rule.matcher.match(normalized)) {
          included = rule.include;
        }
      }

      return included;
    }
  };
}

function compileRule({ pattern, nocase }) {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error('A transfer glob must not be empty');
  }

  const include = !pattern.startsWith('!');
  const expression = include ? pattern : pattern.slice(1);
  if (!expression) {
    throw new Error('A transfer glob must not be empty');
  }

  return {
    include,
    matcher: new Minimatch(expression, {
      dot: true,
      magicalBraces: true,
      nocase,
      nonegate: true
    })
  };
}
