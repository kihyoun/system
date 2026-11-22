// Configuration adapter consumed by the upstream Renovate executable.
import { renovateConfiguration } from './configuration';
export = renovateConfiguration(process.env);
