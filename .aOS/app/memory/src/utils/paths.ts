import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const resolveAosRoot = (): string => {
  // 1. Explicit env var
  if (process.env.AOS_ROOT) return resolve(process.env.AOS_ROOT);

  // 2. Walk up from this file's location (.aOS/app/memory/src/utils/)
  let dir = resolve(import.meta.dir);
  while (dir !== '/') {
    if (existsSync(join(dir, '.aOS'))) return dir;
    dir = dirname(dir);
  }

  // 3. Walk up from cwd
  dir = process.cwd();
  while (dir !== '/') {
    if (existsSync(join(dir, '.aOS'))) return dir;
    dir = dirname(dir);
  }

  throw new Error('Not inside an aOS workspace. Set AOS_ROOT or run from within the repo.');
};

export const resolveMemoryRoot = (): string => {
  const envRoot = process.env.MEMORY_ROOT;
  if (envRoot) return resolve(envRoot);
  return join(resolveAosRoot(), 'memory');
};

export const resolveContextRoot = (): string => {
  const envRoot = process.env.CONTEXT_ROOT;
  if (envRoot) return resolve(envRoot);
  return join(resolveAosRoot(), 'context');
};

export const resolveDailyLogDir = (memoryRoot?: string): string => {
  const root = memoryRoot ?? resolveMemoryRoot();
  return join(root, 'daily-notes');
};

export const resolveDailyNotesDir = (memoryRoot?: string): string =>
  resolveDailyLogDir(memoryRoot);

export const resolveGraphStatePath = (memoryRoot?: string): string => {
  const root = memoryRoot ?? resolveMemoryRoot();
  return join(root, 'data', 'graph-state.json');
};

export const resolveEntityDir = (entityPath: string, contextRoot?: string): string =>
  join(contextRoot ?? resolveContextRoot(), entityPath);

export const resolveParaBuckets = (contextRoot?: string): Record<string, string> => {
  const root = contextRoot ?? resolveContextRoot();
  return {
    projects: join(root, 'projects'),
    people: join(root, 'people'),
    areas: join(root, 'areas'),
    resources: join(root, 'resources'),
    archives: join(root, 'archives'),
  };
};

export const resolveSessionLogDir = (): string => {
  const envRoot = process.env.SESSION_LOG_DIR;
  if (envRoot) return resolve(envRoot);
  return join(resolveAosRoot(), '.aOS', 'logs', 'sessions');
};

export const resolveClaudeCodeSessionDir = (): string => {
  const envRoot = process.env.CLAUDE_CODE_LOG_DIR;
  if (envRoot) return resolve(envRoot);
  const home = process.env.HOME ?? '';
  const root = resolveAosRoot();
  const slug = root.replace(/\//g, '-').replace(/^-/, '');
  return join(home, '.claude', 'projects', slug);
};

export const resolveMemoryMdPath = (memoryRoot?: string): string => {
  const root = memoryRoot ?? resolveMemoryRoot();
  return join(root, 'MEMORY.md');
};

export const resolveVecDbPath = (memoryRoot?: string): string =>
  join(memoryRoot ?? resolveMemoryRoot(), 'data', 'vectors.db');

export const resolveIndexRoots = (memoryRoot?: string): string[] => {
  const roots = [memoryRoot ?? resolveMemoryRoot(), resolveContextRoot()];
  const extra = process.env.MEMORY_INDEX_PATHS;
  if (!extra) return roots;
  const extras = extra.split(',').map((value) => value.trim()).filter(Boolean);
  return [...roots, ...extras.map((value) => resolve(value))];
};
