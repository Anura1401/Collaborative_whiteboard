import { describe, it, expect } from 'vitest';
import { SIM_PACKAGE } from '../src/index.js';

describe('Simulator package scaffold', () => {
  it('loads successfully', () => {
    expect(SIM_PACKAGE).toBe('@whiteboard/sim');
  });
});
