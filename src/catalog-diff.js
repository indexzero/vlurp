/**
 * Compute a structured diff between two catalog snapshots.
 *
 * Both catalogs are expected to have the shape:
 *   { skills: { [name]: { source, ref, version, tool_surface, command_surface, supporting_files, ... } } }
 *
 * Returns a diff object with sources, per-skill diffs, and a summary.
 */
export function diffCatalogs(oldCatalog, newCatalog) {
  const oldSkills = oldCatalog?.skills || {};
  const newSkills = newCatalog?.skills || {};

  const allNames = new Set([...Object.keys(oldSkills), ...Object.keys(newSkills)]);

  // Collect source-level ref changes
  const sources = {};
  for (const name of allNames) {
    const oldSkill = oldSkills[name];
    const newSkill = newSkills[name];
    const skill = newSkill || oldSkill;
    if (skill?.source) {
      const src = skill.source;
      sources[src] ||= {
        old_ref: null, // eslint-disable-line camelcase
        new_ref: null // eslint-disable-line camelcase
      };

      if (oldSkill?.ref) {
        sources[src].old_ref = oldSkill.ref; // eslint-disable-line camelcase
      }

      if (newSkill?.ref) {
        sources[src].new_ref = newSkill.ref; // eslint-disable-line camelcase
      }
    }
  }

  // Diff each skill
  const skills = {};
  const counts = {
    total: 0, new: 0, removed: 0, changed: 0, unchanged: 0
  };

  for (const name of [...allNames].sort()) {
    counts.total++;
    const oldSkill = oldSkills[name];
    const newSkill = newSkills[name];

    if (oldSkill && newSkill) {
      const diff = buildChangedSkillDiff(oldSkill, newSkill);
      skills[name] = diff;
      if (diff.status === 'changed') {
        counts.changed++;
      } else {
        counts.unchanged++;
      }
    } else if (oldSkill) {
      skills[name] = buildRemovedSkillDiff(oldSkill);
      counts.removed++;
    } else {
      skills[name] = buildNewSkillDiff(newSkill);
      counts.new++;
    }
  }

  return {sources, skills, summary: counts};
}

function buildNewSkillDiff(skill) {
  return {
    status: 'new',
    version: {old: null, new: skill.version || null},
    /* eslint-disable camelcase -- SPEC.4 JSON schema */
    tool_surface: {added: [...(skill.tool_surface || [])], removed: []},
    command_surface: {added: [...(skill.command_surface || [])], removed: []},
    supporting_files: {added: [...(skill.supporting_files || [])], removed: []}
    /* eslint-enable camelcase */
  };
}

function buildRemovedSkillDiff(skill) {
  return {
    status: 'removed',
    version: {old: skill.version || null, new: null},
    /* eslint-disable camelcase -- SPEC.4 JSON schema */
    tool_surface: {added: [], removed: [...(skill.tool_surface || [])]},
    command_surface: {added: [], removed: [...(skill.command_surface || [])]},
    supporting_files: {added: [], removed: [...(skill.supporting_files || [])]}
    /* eslint-enable camelcase */
  };
}

function buildChangedSkillDiff(oldSkill, newSkill) {
  const versionDiff = {
    old: oldSkill.version || null,
    new: newSkill.version || null
  };

  /* eslint-disable camelcase -- SPEC.4 JSON schema */
  const toolDiff = diffArrays(oldSkill.tool_surface || [], newSkill.tool_surface || []);
  const commandDiff = diffArrays(oldSkill.command_surface || [], newSkill.command_surface || []);
  const fileDiff = diffArrays(oldSkill.supporting_files || [], newSkill.supporting_files || []);

  const hasChanges = versionDiff.old !== versionDiff.new
    || toolDiff.added.length > 0 || toolDiff.removed.length > 0
    || commandDiff.added.length > 0 || commandDiff.removed.length > 0
    || fileDiff.added.length > 0 || fileDiff.removed.length > 0;

  return {
    status: hasChanges ? 'changed' : 'unchanged',
    version: versionDiff,
    tool_surface: toolDiff,
    command_surface: commandDiff,
    supporting_files: fileDiff
  };
  /* eslint-enable camelcase */
}

function diffArrays(oldArray, newArray) {
  const oldSet = new Set(oldArray);
  const newSet = new Set(newArray);
  return {
    added: newArray.filter(x => !oldSet.has(x)),
    removed: oldArray.filter(x => !newSet.has(x))
  };
}

/**
 * Format a catalog diff as a human-readable string.
 */
export function formatCatalogDiff(diff) {
  const lines = [];

  // Source header
  for (const [src, refs] of Object.entries(diff.sources)) {
    if (refs.old_ref && refs.new_ref && refs.old_ref !== refs.new_ref) {
      lines.push(`${src}  ${refs.old_ref} -> ${refs.new_ref}`);
    } else if (refs.new_ref) {
      lines.push(`${src}  ${refs.new_ref}`);
    } else {
      lines.push(src);
    }
  }

  if (lines.length > 0) {
    lines.push('');
  }

  // Per-skill output
  for (const [name, skillDiff] of Object.entries(diff.skills)) {
    if (skillDiff.status === 'unchanged') {
      continue;
    }

    if (skillDiff.status === 'new') {
      lines.push(`  ${name}  (new skill)`);
      formatSurface(lines, 'tools', skillDiff.tool_surface);
      formatSurface(lines, 'commands', skillDiff.command_surface);
      formatSurface(lines, 'files', skillDiff.supporting_files);
      lines.push('');
      continue;
    }

    if (skillDiff.status === 'removed') {
      lines.push(`  ${name}  (removed)`, '');
      continue;
    }

    // Changed
    const versionStr = skillDiff.version.old === skillDiff.version.new
      ? (skillDiff.version.new || '')
      : `${skillDiff.version.old || '?'} -> ${skillDiff.version.new || '?'}`;
    lines.push(`  ${name}  ${versionStr}`);
    formatSurfaceDelta(lines, 'tools', skillDiff.tool_surface);
    formatSurfaceDelta(lines, 'commands', skillDiff.command_surface);
    formatSurfaceDelta(lines, 'files', skillDiff.supporting_files);
    lines.push('');
  }

  // Summary
  const s = diff.summary;
  const summaryText = `Summary: ${s.total} skills`
    + ` (${s.new} new, ${s.removed} removed, ${s.changed} changed, ${s.unchanged} unchanged)`;
  lines.push(summaryText);

  return lines.join('\n');
}

function formatSurface(lines, label, surface) {
  const items = surface.added;
  const text = items.length > 0 ? items.join(', ') : '(none)';
  lines.push(`    ${label}:    ${text}`);
}

function formatSurfaceDelta(lines, label, surface) {
  const parts = [
    ...surface.added.map(item => `+${item}`),
    ...surface.removed.map(item => `-${item}`)
  ];

  if (parts.length > 0) {
    lines.push(`    ${label}:    ${parts.join(', ')}`);
  }
}
