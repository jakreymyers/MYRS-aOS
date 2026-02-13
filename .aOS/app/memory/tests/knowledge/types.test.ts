import { describe, expect, test } from 'bun:test';
import { isValidCategory, VALID_CATEGORIES } from '../../src/knowledge/types';

describe('Fact categories', () => {
  test('includes v4.2 decision and lesson categories', () => {
    expect(VALID_CATEGORIES).toContain('decision');
    expect(VALID_CATEGORIES).toContain('lesson');
    expect(isValidCategory('decision')).toBe(true);
    expect(isValidCategory('lesson')).toBe(true);
  });
});
