import { describe, expect, test } from 'bun:test';
import { runConsolidate } from '../../src/cli/consolidate';

describe('memory consolidate CLI', () => {
  test('requires --entity', async () => {
    const originalExit = process.exitCode ?? 0;
    process.exitCode = 0;

    await runConsolidate([]);

    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
    if (originalExit !== 0) process.exitCode = originalExit;
  });
});
