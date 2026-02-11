import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EntityMeta, TieredFact } from './types';
import { loadFacts } from './facts';
import { tierFacts } from './decay';
import { getEntity, resolveEntityDir } from './entities';

export type LlmCaller = (prompt: string) => Promise<string>;

/**
 * Generate summary.md content for an entity from its tiered facts.
 * Uses LLM if provided, otherwise falls back to structured output.
 */
export const generateSummary = async (options: {
  meta: EntityMeta;
  tieredFacts: TieredFact[];
  llmCaller?: LlmCaller;
  systemPrompt?: string;
}): Promise<string> => {
  const { meta, tieredFacts, llmCaller, systemPrompt } = options;
  const today = new Date().toISOString().slice(0, 10);

  const hotFacts = tieredFacts.filter((f) => f.tier === 'hot');
  const warmFacts = tieredFacts.filter((f) => f.tier === 'warm');

  if (llmCaller && systemPrompt) {
    try {
      const prompt = buildSummaryPrompt(meta, hotFacts, warmFacts, systemPrompt);
      const result = await llmCaller(prompt);
      if (result.trim()) {
        return ensureFrontMatter(result, meta, today);
      }
    } catch {
      // Fall through to structured fallback
    }
  }

  return buildStructuredSummary(meta, hotFacts, warmFacts, today);
};

/**
 * Refresh summary.md for an entity by loading facts, computing tiers,
 * and rewriting the summary file.
 */
export const refreshEntitySummary = async (options: {
  entityPath: string;
  contextRoot?: string;
  llmCaller?: LlmCaller;
  systemPrompt?: string;
}): Promise<boolean> => {
  const { entityPath, contextRoot, llmCaller, systemPrompt } = options;
  const dir = resolveEntityDir(entityPath, contextRoot);
  const meta = await getEntity(entityPath, contextRoot);
  if (!meta) return false;

  const facts = await loadFacts(dir);
  const today = new Date().toISOString().slice(0, 10);
  const tiered = tierFacts(facts, today);

  const content = await generateSummary({ meta, tieredFacts: tiered, llmCaller, systemPrompt });
  await writeFile(join(dir, 'summary.md'), content);
  return true;
};

// --- Internal helpers ---

const buildSummaryPrompt = (
  meta: EntityMeta,
  hot: TieredFact[],
  warm: TieredFact[],
  systemPrompt: string
): string => {
  const hotSection = hot.map((f) => `- [HOT] ${f.fact} (${f.category}, ${f.timestamp})`).join('\n');
  const warmSection = warm.map((f) => `- [WARM] ${f.fact} (${f.category}, ${f.timestamp})`).join('\n');

  return `${systemPrompt}

Entity: ${meta.name} (${meta.type})
Path: ${meta.path}
Tags: ${meta.tags.join(', ') || '(none)'}

Hot facts (most relevant):
${hotSection || '(none)'}

Warm facts (recent but less active):
${warmSection || '(none)'}

Generate a concise summary for this entity. Do NOT include YAML front matter or code fences.`;
};

const buildStructuredSummary = (
  meta: EntityMeta,
  hot: TieredFact[],
  warm: TieredFact[],
  today: string
): string => {
  const lines = [
    '---',
    `title: "${meta.name}"`,
    `type: ${meta.type}`,
    `para: ${meta.path}`,
    `created: ${meta.created}`,
    `updated: ${today}`,
    `tags: [${meta.tags.join(', ')}]`,
    '---',
    '',
    `# ${meta.name}`,
    '',
  ];

  if (hot.length > 0) {
    lines.push('## Current');
    for (const f of hot) {
      lines.push(`- ${f.fact}`);
    }
    lines.push('');
  }

  if (warm.length > 0) {
    lines.push('## Recent');
    for (const f of warm) {
      lines.push(`- ${f.fact}`);
    }
    lines.push('');
  }

  if (hot.length === 0 && warm.length === 0) {
    lines.push('(No active facts yet.)');
    lines.push('');
  }

  return lines.join('\n');
};

const stripCodeFences = (content: string): string => {
  // Remove ```markdown ... ``` wrapping if present
  let cleaned = content.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```\w*\n/, '').replace(/\n```\s*$/, '');
  }
  return cleaned.trim();
};

const ensureFrontMatter = (content: string, meta: EntityMeta, today: string): string => {
  const cleaned = stripCodeFences(content);
  if (cleaned.startsWith('---')) return cleaned;

  const fm = [
    '---',
    `title: "${meta.name}"`,
    `type: ${meta.type}`,
    `para: ${meta.path}`,
    `created: ${meta.created}`,
    `updated: ${today}`,
    `tags: [${meta.tags.join(', ')}]`,
    '---',
    '',
  ].join('\n');

  return fm + cleaned;
};
