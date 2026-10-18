import path from 'path';

// Configuration has its own lifecycle; it is never part of Harvest/Seed.
export const configDirectory = () => path.resolve(process.env.SYSTEM_CONFIG_DIR || '../system');
export const mainConfigPath = () => path.join(configDirectory(), '.docker.env');
export const projectsDirectory = () => path.join(configDirectory(), '.projects.env');
export const wizardConfigPath = () => path.join(projectsDirectory(), '.wizard.env');
