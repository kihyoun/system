/** Parse declarative environment files without executing commands or expansions. */
export function environmentAssignments(text: string): Record<string, string> {
  if (text.includes('\0')) throw Error('invalid-environment-file');
  const values: Record<string, string> = {};
  let index = 0;
  while (index < text.length) {
    while (/[ \t\r\n]/.test(text[index] || '') && index < text.length) index++;
    if (index >= text.length) break;
    if (text[index] === '#') {
      while (index < text.length && text[index] !== '\n') index++;
      continue;
    }
    const key = /^(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=/.exec(text.slice(index));
    if (!key) throw Error('environment-literal-assignment-required');
    index += key[0].length;
    let value = '',
      quote = '',
      ended = false;
    while (index < text.length) {
      const char = text[index++];
      if (quote === "'") {
        if (char === "'") quote = '';
        else value += char;
        continue;
      }
      if (char === '\\') {
        if (index >= text.length) throw Error('unterminated-environment-escape');
        const next = text[index++];
        if (next === '\n') continue;
        if (quote === '"' && !['$', '`', '"', '\\'].includes(next)) value += '\\';
        value += next;
        continue;
      }
      if (quote === '"') {
        if (char === '"') quote = '';
        else if (char === '$' || char === '`') throw Error('environment-expansion-not-supported');
        else value += char;
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
        while (/[ \t\r]/.test(text[index] || '') && index < text.length) index++;
        if (text[index] === '#') while (index < text.length && text[index] !== '\n') index++;
        if (index < text.length && text[index] !== '\n')
          throw Error('environment-literal-value-required');
        ended = true;
        break;
      }
      if (/[$`;|&<>()]/.test(char)) throw Error('environment-command-not-supported');
      value += char;
    }
    if (quote) throw Error('unterminated-environment-quote');
    values[key[1]] = value;
    if (!ended && index >= text.length) break;
  }
  return values;
}
