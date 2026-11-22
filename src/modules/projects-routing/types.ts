export type Settings = Record<string, string>;
export interface ProjectFile {
  name: string;
  content: string;
}
export interface RoutingSnapshot {
  main: string;
  projects: ProjectFile[];
}
export interface SemanticState {
  values: Settings;
  ownership: string[];
}
export interface AliasRoute {
  aliases: string[];
  origin?: string;
  certificate?: string;
  key?: string;
}
export interface ApplicationRoute extends AliasRoute {
  project: string;
  environment: string;
  canonical: string;
  certificate: string;
  key: string;
}
export function requireValue(value: unknown, message: string): asserts value {
  if (!value) {
    throw Error(message);
  }
}
