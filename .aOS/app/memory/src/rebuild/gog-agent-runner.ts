import { spawnSync } from 'node:child_process';
import { runExtractPrompt } from '../llm/claude';
import type { FactCategory } from '../knowledge/types';
import type { SubagentTask, SubagentTaskResult } from './swarm';

export interface EvidenceItem {
  sourceType: 'gmail' | 'calendar' | 'drive' | 'contacts';
  sourceId: string;
  sourceDate: string;
  title: string;
  snippet: string;
}

export interface GogRunResponse {
  ok: boolean;
  data: unknown;
  error?: string;
}

export interface GogAgentDeps {
  runGog?: (args: string[]) => GogRunResponse;
  runExtract?: (prompt: string) => Promise<string>;
  now?: () => Date;
}

const SYSTEM_PROMPT = `You are a business-context extraction subagent for rebuilding a knowledge graph.

Your goal is to generate high-value, specific facts about ONE entity from Google Workspace evidence.

High-value facts are:
- concrete business relationships (who works with whom, reporting lines, external partners)
- project status and milestones (deliverables, timelines, commitments)
- decisions with rationale
- recurring priorities, constraints, ownership, responsibilities
- lessons or patterns that affect execution

Low-value facts to avoid:
- raw counts (\"has 5 files\", \"appears in 3 threads\")
- tautologies and generic statements
- facts without business relevance

Rules:
- Output ONLY JSON.
- Use only evidence provided.
- Prefer precision and specificity over volume.
- If evidence is weak, output fewer facts.
- Map each fact to one evidenceIndex.
- relatedEntities must come from known entity paths when possible.

Output schema:
{
  "facts": [
    {
      "fact": "Specific business fact",
      "category": "relationship|milestone|status|preference|context|decision|lesson",
      "importance": 1|2|3,
      "timestamp": "YYYY-MM-DDTHH:MM",
      "relatedEntities": ["projects/...", "people/..."],
      "evidenceIndex": 0
    }
  ]
}`;

const GENERIC_FACT_PATTERNS = [
  /\bhas \d+ related drive file/i,
  /\bappears? in \d+ gmail thread/i,
  /\bappears? in \d+ calendar event/i,
  /\bhas \d+ (emails|messages|files|threads)\b/i,
  /\b(has|appears?|mentions?)\s+\d+\b/i,
  /\brelated files?\b/i,
];

const parseJson = (raw: string): unknown | null => {
  try {
    return JSON.parse(raw.trim());
  } catch {
    // continue
  }
  const stripped = raw.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // continue
  }
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
  return null;
};

const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const asRecord = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object') ? v as Record<string, unknown> : {};

const toFactCategory = (v: unknown): FactCategory =>
  v === 'relationship' || v === 'milestone' || v === 'status'
    || v === 'preference' || v === 'context' || v === 'decision' || v === 'lesson'
    ? v
    : 'context';

const toImportance = (v: unknown): 1 | 2 | 3 => v === 2 || v === 3 ? v : 1;

const toTimestamp = (v: unknown): string => {
  if (!isNonEmpty(v)) return new Date().toISOString().slice(0, 16);
  return String(v).slice(0, 16);
};

const runGog = (args: string[]): GogRunResponse => {
  const out = spawnSync('gog', [...args, '--json', '--no-input'], { encoding: 'utf8', timeout: 60_000 });
  if (out.status !== 0) {
    return { ok: false, data: null, error: (out.stderr || out.stdout || '').trim() };
  }
  const parsed = parseJson(out.stdout);
  if (!parsed) return { ok: false, data: null, error: 'invalid json from gog' };
  return { ok: true, data: parsed };
};

const addEvidence = (arr: EvidenceItem[], evidence: EvidenceItem): void => {
  if (!isNonEmpty(evidence.sourceId)) return;
  if (!isNonEmpty(evidence.sourceDate)) return;
  const key = `${evidence.sourceType}:${evidence.sourceId}`;
  if (arr.some((row) => `${row.sourceType}:${row.sourceId}` === key)) return;
  arr.push(evidence);
};

const toDate = (value: unknown): string => {
  if (!isNonEmpty(value)) return new Date().toISOString();
  return String(value);
};

export const extractFollowupTerms = (evidence: EvidenceItem[], seed: string, limit = 4): string[] => {
  const combined = evidence.map((e) => `${e.title} ${e.snippet}`).join('\n');
  const tokens = (combined.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g) ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length > 5 && t.toLowerCase() !== seed.toLowerCase());
  const deduped: string[] = [];
  for (const token of tokens) {
    if (!deduped.includes(token)) deduped.push(token);
    if (deduped.length >= limit) break;
  }
  return deduped;
};

const readTask = async (): Promise<SubagentTask> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('invalid task json');
  return parsed as SubagentTask;
};

const buildPrompt = (task: SubagentTask, evidence: EvidenceItem[]): string => {
  const known = (task.knownEntityPaths ?? []).slice(0, 200).join('\n');
  const evidenceBlock = evidence.map((e, i) =>
    `[${i}] (${e.sourceType}) id=${e.sourceId} date=${e.sourceDate}\nTitle: ${e.title}\nSnippet: ${e.snippet}`,
  ).join('\n\n');

  return `${SYSTEM_PROMPT}

Entity path: ${task.entityPath}
Entity name: ${task.entity?.name ?? task.entityPath.split('/').pop() ?? 'unknown'}
Entity type: ${task.entityType}
Tags: ${(task.entity?.tags ?? []).join(', ') || '(none)'}

Known entity paths (for relatedEntities selection):
${known || '(none)'}

Evidence:
${evidenceBlock || '(none)'}
`;
};

const selectRelated = (raw: unknown, known: string[]): string[] => {
  const knownSet = new Set(known);
  const aliasMap = new Map<string, string>();
  for (const path of known) {
    aliasMap.set(path.toLowerCase(), path);
    aliasMap.set(path.replaceAll('-', ' ').toLowerCase(), path);
    const slug = path.split('/').pop() ?? path;
    aliasMap.set(slug.toLowerCase(), path);
    aliasMap.set(slug.replaceAll('-', ' ').toLowerCase(), path);
  }

  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .replace(/^["']|["']$/g, '')
      .replace(/[^a-z0-9/ -]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const normalized = normalize(v);
    const mapped = knownSet.has(v) ? v : aliasMap.get(normalized);
    if (!mapped) continue;
    if (!out.includes(mapped)) out.push(mapped);
    if (out.length >= 5) break;
  }
  return out;
};

const buildEntityQueryVariants = (task: SubagentTask, entityName: string): string[] => {
  const variants: string[] = [];
  const slug = (task.entityPath.split('/').pop() ?? '').replaceAll('-', ' ').trim();
  const tags = (task.entity?.tags ?? []).map((tag) => tag.replaceAll('-', ' ').trim()).filter(Boolean);
  const candidates = [entityName.trim(), slug, ...tags];
  for (const value of candidates) {
    if (!value) continue;
    const normalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
    if (normalized.length < 3) continue;
    if (!variants.some((existing) => existing.toLowerCase() === normalized)) {
      variants.push(value);
    }
  }
  return variants.slice(0, 4);
};

export const isLowValueFact = (fact: string): boolean =>
  GENERIC_FACT_PATTERNS.some((rx) => rx.test(fact));

const materializeFacts = (
  draftFacts: unknown[],
  evidence: EvidenceItem[],
  knownEntityPaths: string[],
): SubagentTaskResult['payload']['facts'] => {
  const facts: SubagentTaskResult['payload']['facts'] = [];
  for (const rawRow of draftFacts) {
    const row = (rawRow && typeof rawRow === 'object')
      ? rawRow as Record<string, unknown>
      : null;
    if (!row) continue;
    if (!isNonEmpty(row?.fact)) continue;
    if (isLowValueFact(row.fact)) continue;
    if (row.fact.trim().length < 20) continue;

    const evidenceIndex = Number(row.evidenceIndex);
    if (!Number.isInteger(evidenceIndex) || evidenceIndex < 0 || evidenceIndex >= evidence.length) continue;
    const ev = evidence[evidenceIndex];

    facts.push({
      fact: row.fact.trim(),
      category: toFactCategory(row.category),
      importance: toImportance(row.importance),
      timestamp: toTimestamp(row.timestamp ?? ev.sourceDate),
      relatedEntities: selectRelated(row.relatedEntities, knownEntityPaths),
      provenance: {
        sourceType: ev.sourceType,
        sourceId: ev.sourceId,
        sourceDate: ev.sourceDate,
      },
    });

    if (facts.length >= 12) break;
  }
  return facts;
};

export const runGogAgentTask = async (
  task: SubagentTask,
  deps: GogAgentDeps = {},
): Promise<SubagentTaskResult> => {
  const maxCalls = Math.max(1, Number(task.maxCalls || 10));
  const entityName = isNonEmpty(task.entity?.name)
    ? task.entity!.name
    : (task.entityPath.split('/').pop() ?? 'unknown').replace(/-/g, ' ');
  const knownEntityPaths = task.knownEntityPaths ?? [];
  const callGog = deps.runGog ?? runGog;
  const now = deps.now ?? (() => new Date());
  const extract = deps.runExtract ?? (async (prompt: string) =>
    runExtractPrompt(prompt, { timeoutMs: 20_000 }));

  let calls = 0;
  const evidence: EvidenceItem[] = [];
  const call = (args: string[]) => {
    if (calls >= maxCalls) return { ok: false, data: null, error: 'budget exceeded' };
    calls++;
    return callGog(args);
  };

  const queryVariants = buildEntityQueryVariants(task, entityName);
  const runGmailSearch = (queryText: string, maxRows: number): void => {
    const query = `${queryText} newer_than:1095d`;
    const gmailMessages = call(['gmail', 'messages', 'search', query, '--max', String(maxRows), '--include-body']);
    if (!gmailMessages.ok) return;
    const data = asRecord(gmailMessages.data);
    const rows = data['messages'] ?? data['results'] ?? [];
    if (!Array.isArray(rows)) return;
    for (const rawRow of rows.slice(0, maxRows)) {
      const row = asRecord(rawRow);
      addEvidence(evidence, {
        sourceType: 'gmail',
        sourceId: String(row.id ?? row.messageId ?? row.threadId ?? ''),
        sourceDate: toDate(row.internalDate ?? row.date ?? row.timestamp),
        title: String(row.subject ?? row.threadSubject ?? row.from ?? entityName),
        snippet: String(row.snippet ?? row.body ?? '').slice(0, 1200),
      });
    }
  };

  const runDriveSearch = (queryText: string, maxRows: number): void => {
    const drive = call(['drive', 'search', queryText, '--max', String(maxRows)]);
    if (!drive.ok) return;
    const data = asRecord(drive.data);
    const files = data['files'] ?? [];
    if (!Array.isArray(files)) return;
    for (const rawFile of files.slice(0, maxRows)) {
      const file = asRecord(rawFile);
      addEvidence(evidence, {
        sourceType: 'drive',
        sourceId: String(file.id ?? ''),
        sourceDate: toDate(file.modifiedTime ?? file.createdTime),
        title: String(file.name ?? entityName),
        snippet: String(file.webViewLink ?? file.mimeType ?? ''),
      });
    }

    for (const rawFile of files.slice(0, 2)) {
      const file = asRecord(rawFile);
      if (calls >= maxCalls) break;
      const fileId = String(file.id ?? '');
      if (!isNonEmpty(fileId)) continue;
      const details = call(['drive', 'get', fileId]);
      if (!details.ok) continue;
      const meta = (details.data && typeof details.data === 'object')
        ? details.data as Record<string, unknown>
        : {};
      const owners = Array.isArray(meta.owners)
        ? meta.owners
          .map((owner) => {
            if (!owner || typeof owner !== 'object') return null;
            const row = owner as Record<string, unknown>;
            return typeof row.displayName === 'string'
              ? row.displayName
              : (typeof row.emailAddress === 'string' ? row.emailAddress : null);
          })
          .filter((value): value is string => Boolean(value))
          .join(', ')
        : '';
      const snippet = [meta.description, owners]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join(' | ');
      addEvidence(evidence, {
        sourceType: 'drive',
        sourceId: String(meta.id ?? fileId),
        sourceDate: toDate(meta.modifiedTime ?? meta.createdTime),
        title: String(meta.name ?? file.name ?? entityName),
        snippet: String(snippet).slice(0, 1200),
      });
    }
  };

  runGmailSearch(queryVariants[0] ?? entityName, 8);
  runDriveSearch(queryVariants[0] ?? entityName, 6);

  // If the primary query is sparse, probe fallback terms from path/tag variants.
  if (evidence.length < 3) {
    for (const variant of queryVariants.slice(1)) {
      if (calls >= maxCalls) break;
      runGmailSearch(variant, 4);
      if (calls >= maxCalls) break;
      runDriveSearch(variant, 4);
      if (evidence.length >= 8) break;
    }
  }

  const cal = call(['calendar', 'events', 'primary', '--from', '2025-01-01', '--to', now().toISOString().slice(0, 10), '--max', '20']);
  if (cal.ok) {
    const data = asRecord(cal.data);
    const events = data['events'] ?? data['items'] ?? [];
    if (Array.isArray(events)) {
      for (const rawEvent of events.slice(0, 20)) {
        const ev = asRecord(rawEvent);
        const start = asRecord(ev.start);
        const organizer = asRecord(ev.organizer);
        const title = String(ev.summary ?? entityName);
        const snippet = String(ev.description ?? organizer.email ?? '').slice(0, 1200);
        const text = `${title} ${snippet}`.toLowerCase();
        if (!text.includes(entityName.toLowerCase())) continue;
        addEvidence(evidence, {
          sourceType: 'calendar',
          sourceId: String(ev.id ?? ''),
          sourceDate: toDate(start.dateTime ?? start.date ?? ev.created ?? ev.updated),
          title,
          snippet,
        });
        if (evidence.length >= 32) break;
      }
    }
  }

  if (task.entityType === 'people') {
    const contacts = call(['contacts', 'list', '--max', '200']);
    if (contacts.ok) {
      const data = asRecord(contacts.data);
      const rows = data['contacts'] ?? data['people'] ?? data['results'] ?? [];
      if (Array.isArray(rows)) {
        const nameLower = entityName.toLowerCase();
        const match = rows.find((rawRow: unknown) => {
          if (!rawRow || typeof rawRow !== 'object') return false;
          const row = rawRow as Record<string, unknown>;
          const label = String(row.name ?? row.displayName ?? '').toLowerCase();
          return label.includes(nameLower) || nameLower.includes(label);
        });
        if (match) {
          const row = (match && typeof match === 'object')
            ? match as Record<string, unknown>
            : {};
          addEvidence(evidence, {
            sourceType: 'contacts',
            sourceId: String(row.resourceName ?? row.id ?? row.etag ?? 'contact'),
            sourceDate: toDate(row.updateTime ?? now().toISOString()),
            title: String(row.name ?? row.displayName ?? entityName),
            snippet: String(row.email ?? '').slice(0, 1200),
          });
        }
      }
    }
  }

  const followups = extractFollowupTerms(evidence, entityName, 4);
  for (const term of followups) {
    if (calls >= maxCalls) break;
    const q = `"${entityName}" "${term}" newer_than:1095d`;
    const followGmail = call(['gmail', 'messages', 'search', q, '--max', '3', '--include-body']);
    if (!followGmail.ok) continue;
    const data = asRecord(followGmail.data);
    const rows = data['messages'] ?? data['results'] ?? [];
    if (!Array.isArray(rows)) continue;
    for (const rawRow of rows.slice(0, 3)) {
      const row = asRecord(rawRow);
      addEvidence(evidence, {
        sourceType: 'gmail',
        sourceId: String(row.id ?? row.messageId ?? row.threadId ?? ''),
        sourceDate: toDate(row.internalDate ?? row.date ?? row.timestamp),
        title: String(row.subject ?? term),
        snippet: String(row.snippet ?? row.body ?? '').slice(0, 1200),
      });
    }

    if (calls >= maxCalls) continue;
    const followDrive = call(['drive', 'search', `${entityName} ${term}`, '--max', '3']);
    if (!followDrive.ok) continue;
    const followDriveData = asRecord(followDrive.data);
    const files = followDriveData['files'] ?? [];
    if (!Array.isArray(files)) continue;
    for (const rawFile of files.slice(0, 3)) {
      const file = asRecord(rawFile);
      addEvidence(evidence, {
        sourceType: 'drive',
        sourceId: String(file.id ?? ''),
        sourceDate: toDate(file.modifiedTime ?? file.createdTime),
        title: String(file.name ?? `${entityName} ${term}`),
        snippet: String(file.webViewLink ?? file.mimeType ?? '').slice(0, 1200),
      });
    }
  }

  const prompt = buildPrompt(task, evidence.slice(0, 40));
  const raw = await extract(prompt);
  const parsed = parseJson(raw);
  const parsedObj = asRecord(parsed);
  const draftFacts = Array.isArray(parsedObj['facts']) ? parsedObj['facts'] : [];
  let facts = materializeFacts(draftFacts, evidence, knownEntityPaths);

  if (facts.length === 0 && evidence.length > 0) {
    const rescuePrompt = `${prompt}

Previous output produced zero accepted facts.
Retry and output 1-3 concise, concrete, business-relevant facts grounded in evidence.
Do not output count-based facts.`;
    const rescueRaw = await extract(rescuePrompt);
    const rescueParsed = parseJson(rescueRaw);
    const rescueObj = asRecord(rescueParsed);
    const rescueDraft = Array.isArray(rescueObj['facts']) ? rescueObj['facts'] : [];
    facts = materializeFacts(rescueDraft, evidence, knownEntityPaths);
  }

  const payload: SubagentTaskResult['payload'] = {
    entityPath: task.entityPath,
    facts,
    generatedAt: now().toISOString(),
    generatedBy: 'gog-agent-runner-v2',
  };

  return { callCount: calls, payload };
};

const main = async (): Promise<void> => {
  const task = await readTask();
  const result = await runGogAgentTask(task);
  process.stdout.write(JSON.stringify(result));
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error(message);
    process.exit(1);
  });
}
