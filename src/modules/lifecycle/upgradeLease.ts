import fs from 'node:fs';
import path from 'node:path';
/** Reentrancy is restricted to a live ancestor that owns all upgrade barriers. */
export function inheritedUpgrade(state: string, operation: string | undefined): boolean {
  if (operation === undefined) {
    return false;
  }

  const fail = (): never => {
    throw Error('GitLab upgrade lifecycle ownership differs.');
  };

  if (!/^[a-f0-9]{32}$/.test(operation)) {
    return fail();
  }

  let previous = '';
  let owner: Record<string, unknown> = {};
  for (const name of [
    '.gitlab-upgrade-lock',
    '.storage-operation-lock',
    '.projects.env/.wizard.env.environments.lock',
  ]) {
    const directory = path.join(state, name),
      file = path.join(directory, 'upgrade-owner.json');

    if (
      !fs.lstatSync(directory, { throwIfNoEntry: false })?.isDirectory() ||
      !fs.lstatSync(file, { throwIfNoEntry: false })?.isFile()
    ) {
      return fail();
    }

    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return fail();
    }

    owner = value as Record<string, unknown>;

    if (
      owner.format !== 'system-gitlab-upgrade-lock-v1' ||
      owner.operation !== operation ||
      !Number.isSafeInteger(owner.pid) ||
      Number(owner.pid) < 1 ||
      typeof owner.start !== 'string'
    ) {
      return fail();
    }

    const identity = JSON.stringify([owner.operation, owner.pid, owner.start]);

    if (previous && previous !== identity) {
      return fail();
    }

    previous = identity;
  }
  let pid = process.pid;
  for (let depth = 0; depth < 64 && pid > 0; depth++) {
    let text: string;
    try {
      text = fs.readFileSync('/proc/' + pid + '/stat', 'utf8');
    } catch {
      return fail();
    }
    const fields = text
      .slice(text.lastIndexOf(')') + 2)
      .trim()
      .split(/\s+/);

    if (pid === owner.pid) {
      if (fields[0] === 'Z' || fields[19] !== owner.start) {
        return fail();
      }

      return true;
    }

    pid = Number(fields[1]);
  }
  return fail();
}
