import { describe, expect, test } from 'bun:test';
import { hashContent } from '../../src/utils/hash';

describe('Content hashing', () => {
  test('hash is deterministic and length 16', () => {
    const content = 'deterministic content';
    const hash1 = hashContent(content);
    const hash2 = hashContent(content);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(16);
  });
});
