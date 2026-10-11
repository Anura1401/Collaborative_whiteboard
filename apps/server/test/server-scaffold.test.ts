import { describe, it, expect } from 'vitest';
import { config, loadConfig } from '../src/config.js';

describe('Server configuration', () => {
  it('loads successfully with default values', () => {
    expect(config.PORT).toBeDefined();
    expect(typeof loadConfig).toBe('function');
  });
});

