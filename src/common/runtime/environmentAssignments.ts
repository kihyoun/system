/** Parse declarative environment files without executing commands or expansions. */
export interface EnvironmentAssignment {
  name: string;
  value: string;
  start: number;
  end: number;
  kind: 'assignment' | 'unset';
}
export function environmentAssignments(
  text: string,
  observe?: (assignment: EnvironmentAssignment) => void,
): Record<string, string> {
  if (text.includes('\0')) {
    throw Error('invalid-environment-file');
  }

  const values: Record<string, string> = {};
  let index = 0;
  while (index < text.length) {
    while (/[ \t\r\n]/.test(text[index] || '') && index < text.length) {
      index++;
    }

    if (index >= text.length) {
      break;
    }

    if (text[index] === '#') {
      while (index < text.length && text[index] !== '\n') {
        index++;
      }
      continue;
    }

    const start = index;
    const unset =
      /^unset[ \t]+([A-Za-z_][A-Za-z0-9_]*(?:[ \t]+[A-Za-z_][A-Za-z0-9_]*)*)[ \t]*(?:#[^\n]*)?(?:\r?\n|$)/.exec(
        text.slice(index),
      );

    if (unset) {
      // An explicit empty value also clears inherited values when callers merge
      // declarative configuration layers; downstream defaults remain available.
      index += unset[0].length;
      for (const name of unset[1].split(/[ \t]+/)) {
        values[name] = '';
        observe?.({ name, value: '', start, end: index, kind: 'unset' });
      }
      continue;
    }

    const key = /^(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(text.slice(index));

    if (!key) {
      throw Error('environment-literal-assignment-required');
    }

    index += key[0].length;
    let value = '',
      quote = '',
      ended = false;
    while (index < text.length) {
      const char = text[index++];

      if (quote === "'") {
        if (char === "'") {
          quote = '';
        } else {
          value += char;
        }

        continue;
      }

      if (char === '\\') {
        if (index >= text.length) {
          throw Error('unterminated-environment-escape');
        }

        const next = text[index++];

        if (next === '\n') {
          continue;
        }

        if (quote === '"' && !['$', '`', '"', '\\'].includes(next)) {
          value += '\\';
        }

        value += next;
        continue;
      }

      if (quote === '"') {
        if (char === '"') {
          quote = '';
        } else if (char === '$' || char === '`') {
          throw Error('environment-expansion-not-supported');
        } else {
          value += char;
        }

        continue;
      }

      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }

      if (char === '\n') {
        ended = true;
        break;
      }

      if (/[ \t\r]/.test(char)) {
        while (/[ \t\r]/.test(text[index] || '') && index < text.length) {
          index++;
        }

        if (text[index] === '#') {
          while (index < text.length && text[index] !== '\n') {
            index++;
          }
        }

        if (index < text.length && text[index] !== '\n') {
          throw Error('environment-literal-value-required');
        }

        ended = true;
        break;
      }

      if (/[$`;|&<>()]/.test(char)) {
        throw Error('environment-command-not-supported');
      }

      value += char;
    }

    if (quote) {
      throw Error('unterminated-environment-quote');
    }

    values[key[1]] = value;
    observe?.({ name: key[1], value, start, end: index, kind: 'assignment' });

    if (!ended && index >= text.length) {
      break;
    }
  }
  return values;
}
