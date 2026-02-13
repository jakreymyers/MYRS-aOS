import { spawn } from 'node:child_process';
import type { SubagentRunner, SubagentTask, SubagentTaskResult } from './swarm';
import { validateStagingPayload } from './staging';

const runCommandJson = async (command: string, input: unknown): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (buf) => {
      stdout += String(buf);
    });
    child.stderr.on('data', (buf) => {
      stderr += String(buf);
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`subagent command failed (${code}): ${stderr.trim() || 'no stderr'}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'parse error';
        reject(new Error(`subagent command returned invalid JSON: ${message}`));
      }
    });

    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });

export const createCommandSubagentRunner = (command: string): SubagentRunner => ({
  runTask: async (task: SubagentTask): Promise<SubagentTaskResult> => {
    const out = await runCommandJson(command, task) as unknown;
    if (!out || typeof out !== 'object') {
      throw new Error('subagent command returned non-object payload');
    }
    const row = out as Partial<SubagentTaskResult>;
    if (typeof row.callCount !== 'number') {
      throw new Error('subagent command missing numeric callCount');
    }
    if (!row.payload || typeof row.payload !== 'object') {
      throw new Error('subagent command missing payload object');
    }
    const validation = validateStagingPayload(row.payload);
    if (!validation.valid) {
      throw new Error(`subagent command returned invalid payload: ${validation.errors.join('; ')}`);
    }
    return {
      callCount: row.callCount,
      payload: row.payload,
    };
  },
});
