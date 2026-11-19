import path from 'path';

// Configuration has its own lifecycle; it is never part of Harvest/Seed.
export const configDirectory = () => path.resolve(process.env.SYSTEM_CONFIG_DIR || '../system');
export const mainConfigPath = () => path.join(configDirectory(), '.docker.env');
export const projectsDirectory = () => path.join(configDirectory(), '.projects.env');
export const wizardConfigPath = () => path.join(projectsDirectory(), '.wizard.env');

export function projectConfigPath(key: unknown): string {
  if (typeof key !== 'string' || !/^[a-z0-9]+$/.test(key)) throw Error('Invalid project key');
  const root = projectsDirectory();
  const filename = path.resolve(root, '.' + key + '.env');
  if (path.dirname(filename) !== root) throw Error('Invalid project path');
  return filename;
}
