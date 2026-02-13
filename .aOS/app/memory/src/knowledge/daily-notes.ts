import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { resolveMemoryRoot } from '../utils/paths';
import { atomicWrite } from '../utils/atomic';

/**
 * Resolve the daily notes directory path.
 */
export const resolveDailyNotesDir = (memoryRoot?: string): string =>
  join(memoryRoot ?? resolveMemoryRoot(), 'daily-notes');

/**
 * Append a structured entry to a daily note file.
 * Creates the file with a date heading if it doesn't exist.
 * Deterministic — no LLM calls.
 */
export const appendDailyNote = async (options: {
  dir?: string;
  date: string;            // YYYY-MM-DD
  sessionId: string;
  time: string;            // HH:MM
  summary: string;
  factCount: number;
  entityPaths: string[];
  entityFactCounts?: Record<string, number>;
  decisions?: string[];
  lessons?: string[];
}): Promise<string> => {
  const { date, sessionId, time, summary, factCount, entityPaths } = options;
  const dir = options.dir ?? resolveDailyNotesDir();
  const filePath = join(dir, `${date}.md`);

  await mkdir(dir, { recursive: true });

  let existing = '';
  try {
    existing = await readFile(filePath, 'utf8');
  } catch {
    // File doesn't exist — create with date heading
  }

  const shortId = sessionId.slice(0, 8);
  const entry = formatEntry(
    sessionId,
    time,
    summary,
    factCount,
    entityPaths,
    options.entityFactCounts,
    options.decisions,
    options.lessons,
  );

  if (!existing) {
    // New file
    const content = `# ${date}\n\n${entry}`;
    await atomicWrite(filePath, content);
  } else {
    // Replace existing entry for this session, or append if new
    const pattern = new RegExp(
      `## Session ${shortId} \\([^)]*\\)\\n[\\s\\S]*?(?=\\n## |$)`
    );
    if (pattern.test(existing)) {
      await atomicWrite(filePath, existing.replace(pattern, entry.trimEnd()));
    } else {
      await atomicWrite(filePath, existing.trimEnd() + '\n\n' + entry);
    }
  }

  return filePath;
};

const formatEntry = (
  sessionId: string,
  time: string,
  summary: string,
  factCount: number,
  entityPaths: string[],
  entityFactCounts?: Record<string, number>,
  decisions?: string[],
  lessons?: string[],
): string => {
  const shortId = sessionId.slice(0, 8);
  const lines = [`## Session ${shortId} (${time})`, '', summary.trim()];

  if (factCount > 0 || entityPaths.length > 0) {
    let entityList: string;
    if (entityFactCounts && Object.keys(entityFactCounts).length > 0) {
      entityList = Object.entries(entityFactCounts)
        .sort(([, a], [, b]) => b - a)
        .map(([path, count]) => `${path} (${count})`)
        .join(', ');
    } else {
      entityList = entityPaths.join(', ');
    }
    lines.push('', `_${factCount} facts → ${entityList}_`);
  }

  if (decisions && decisions.length > 0) {
    lines.push('', 'Recent decisions:');
    for (const decision of decisions.slice(0, 5)) {
      lines.push(`- ${decision}`);
    }
  }

  if (lessons && lessons.length > 0) {
    lines.push('', 'Lessons learned:');
    for (const lesson of lessons.slice(0, 5)) {
      lines.push(`- ${lesson}`);
    }
  }

  return lines.join('\n') + '\n';
};
