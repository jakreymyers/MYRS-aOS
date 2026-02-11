import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAosRoot } from '../utils/paths.js';

const PROMPT_DIR = join(resolveAosRoot(), 'prompts', 'aos-memory');

const readPrompt = (filename: string): string => {
  try {
    return readFileSync(join(PROMPT_DIR, filename), 'utf8');
  } catch (error: any) {
    const message = error?.message ?? 'unknown error';
    throw new Error(`Missing prompt file: ${filename} (${message})`);
  }
};

export const CURATE_SYSTEM_PROMPT = readPrompt('curate-system.txt');
export const CURATE_USER_PROMPT = readPrompt('curate-user.txt');
export const EXTRACT_SYSTEM_PROMPT = readPrompt('extract-system.txt');
export const EXTRACT_USER_PROMPT = readPrompt('extract-user.txt');
export const SUMMARIZE_SYSTEM_PROMPT = readPrompt('summarize-system.txt');

export const fillPrompt = (template: string, values: Record<string, string>): string => {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.replaceAll(`{{${key}}}`, value);
  }
  return output;
};
