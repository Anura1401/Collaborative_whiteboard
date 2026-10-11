import { describe, it, expect } from 'vitest';
import { SHARED_PACKAGE } from '../src/index.js';

describe('Shared package scaffold', () => {
  it('loads successfully', () => {
    expect(SHARED_PACKAGE).toBe('@whiteboard/shared');
  });
});
