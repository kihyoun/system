export type PreviewSource = {mode: 'existing' | 'import'; project: string; origin: string};
export type PreviewHost = {enabled: boolean; host: string; ssl: string; sslKey: string};
export type PreviewSetupIntent = {version: 1; namespace: string; wizard: PreviewSource; system?: PreviewSource; review: PreviewHost; beta: PreviewHost};
/** Desired settings are untrusted data. Credentials, instance IDs and receipts
 * are deliberately excluded; opening a backup never invokes setup. */
export function previewSetupIntent(value: any): PreviewSetupIntent | null {
  const object = (item: any, keys: string[]) => item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).every(key => keys.includes(key));
  if (!object(value, ['version', 'namespace', 'wizard', 'system', 'review', 'beta']) || value.version !== 1 || typeof value.namespace !== 'string' || value.namespace.length > 1024) return null;
  const controls = (text: string) => Array.from(text).some(character => character.charCodeAt(0) < 32);
  const source = (item: any) => object(item, ['mode', 'project', 'origin']) && ['import', 'existing'].includes(item.mode) &&
    ['project', 'origin'].every(key => typeof item[key] === 'string' && item[key].length <= 2048) && !controls(item.project + item.origin) &&
    (item.mode === 'existing' ? item.origin === '' : (() => { try {const url = new URL(item.origin); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;} catch { return false; } })());
  const host = (item: any) => object(item, ['enabled', 'host', 'ssl', 'sslKey']) && typeof item.enabled === 'boolean' && ['host', 'ssl', 'sslKey'].every(key => typeof item[key] === 'string' && item[key].length <= 1024 && !controls(item[key]));
  if (!source(value.wizard) || value.system && !source(value.system) || !host(value.review) || !host(value.beta)) return null;
  return JSON.parse(JSON.stringify(value));
}
export function newPreviewSetupIntent(): PreviewSetupIntent {
  return {version: 1, namespace: '', wizard: {mode: 'import', project: 'system-wizard', origin: ''},
    review: {enabled: true, host: '', ssl: '', sslKey: ''}, beta: {enabled: false, host: '', ssl: '', sslKey: ''}};
}
