import { describe, it, expect } from 'vitest';
import { App } from '../src/main.js';

describe('Web package scaffold', () => {
  it('App component exists', () => {
    expect(typeof App).toBe('function');
  });
});
