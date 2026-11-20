/** Literal shell configuration only: never evaluate code or expand variables. */
export function shellValue(input: string): string {
  let result = '';
  let quote = '';
  const source = input.trim();
  if (source.includes('\0') || source.startsWith('~')) throw new Error('Use a literal configuration value without shell expansion');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote === "'") {
      if (char === "'") quote = '';
      else result += char;
    } else if (char === '\\') {
      const next = source[++i];
      if (next === undefined) throw new Error('Incomplete shell escape in configuration');
      if (quote === '"' && !['$', '`', '"', '\\', '\n'].includes(next)) result += '\\';
      if (next !== '\n') result += next;
    } else if (char === quote) {
      quote = '';
    } else if (!quote && (char === "'" || char === '"')) {
      quote = char;
    } else if ((char === '$' && /[A-Za-z0-9_({?*!@#$'"-]/.test(source[i + 1] || '')) || char === '`') {
      throw new Error('Shell expansion is not supported in configuration; use literal values');
    } else if (!quote && /\s/.test(char)) {
      const remainder = source.slice(i).trim();
      if (remainder && !remainder.startsWith('#')) throw new Error('Unexpected shell command in configuration');
      break;
    } else if (!quote && /[;&|<>()]/.test(char)) {
      throw new Error('Shell commands are not supported in configuration');
    } else {
      result += char;
    }
  }
  if (quote) throw new Error('Unclosed shell quote in configuration');
  return result;
}

export function shellQuote(value: any): string {
  // Double quotes retain the historic export format; escape all active shell bytes.
  return '"' + String(value ?? '').replace(/[\\"$`]/g, '\\$&') + '"';
}

export function environment(data: string): Array<[string, string]> {
  const assignments: Array<[string, string]> = [];
  let record = '';
  let quote = '';
  let escaped = false;
  data.split('\n').forEach((line, index) => {
    if (!record && (!line.trim() || line.trim().startsWith('#'))) return;
    record += (record ? '\n' : '') + line;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (escaped) { escaped = false; continue; }
      if (quote === "'") { if (char === "'") quote = ''; }
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      else if (!quote && (char === "'" || char === '"')) quote = char;
      else if (!quote && char === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
    }
    if (quote || escaped) { escaped = false; return; }
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(record);
    if (!match) throw new Error(`Unsupported configuration assignment on line ${index + 1}`);
    // Validate everything before any model mutation. setProperty decodes once.
    shellValue(match[2]);
    assignments.push([match[1], match[2]]);
    record = '';
  });
  if (record) throw new Error('Incomplete configuration assignment');
  return assignments;
}

export function extraEnvironment(values: {[key: string]: string}): string {
  return Object.keys(values).sort().map(key => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('Invalid runtime option name');
    return `export ${key}=${shellQuote(values[key])}\n`;
  }).join('');
}
