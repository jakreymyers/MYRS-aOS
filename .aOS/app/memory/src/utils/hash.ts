import { createHash } from 'node:crypto';

export const hashContent = (content: string): string => {
  const hash = createHash('sha256').update(content).digest('hex');
  return hash.slice(0, 16);
};
