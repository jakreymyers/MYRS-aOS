import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Write content atomically by writing a temp file and renaming into place.
 */
export const atomicWrite = async (filePath: string, content: string): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tmpPath, content);
  await rename(tmpPath, filePath);
};
