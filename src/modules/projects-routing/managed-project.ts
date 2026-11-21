// Keep the server-owned default project across ordinary Wizard configuration Push.
import fs from 'node:fs';
const marker = '# BOOTSTRAPPER_PROJECT=';
export function managed(data: string) {
  try {
    const line = data.split('\n').find((value) => value.startsWith(marker));
    const receipt: unknown = JSON.parse(
      Buffer.from(line!.slice(marker.length), 'base64').toString('utf8'),
    );
    return (
      !!receipt &&
      typeof receipt === 'object' &&
      'defaultProject' in receipt &&
      receipt.defaultProject === true &&
      'template' in receipt &&
      receipt.template === 'wizard'
    );
  } catch (_) {
    return false;
  }
}
export function preserve(action: string, file: string, backup: string) {
  if (action === 'snapshot') {
    if (fs.existsSync(backup)) fs.unlinkSync(backup);
    if (fs.existsSync(file)) {
      const data = fs.readFileSync(file, 'utf8');
      if (managed(data)) fs.writeFileSync(backup, data, { mode: 0o600 });
    }
  } else if (action === 'restore' && fs.existsSync(backup)) {
    const data = fs.readFileSync(backup, 'utf8');
    if (!managed(data)) throw Error('Invalid system project snapshot');
    fs.writeFileSync(file + '.tmp', data, { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
    fs.unlinkSync(backup);
  }
}
