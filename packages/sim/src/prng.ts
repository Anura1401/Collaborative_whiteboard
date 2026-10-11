/**
 * Mulberry32 seeded deterministic PRNG.
 * Produces fast, high-quality pseudo-random 32-bit values.
 */
export class PRNG {
  private state: number;

  constructor(seed = 1337) {
    this.state = seed >>> 0;
  }

  /** Returns float in range [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns integer in range [min, max] inclusive */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Returns random element from array */
  pick<T>(items: readonly T[]): T {
    const idx = this.nextInt(0, items.length - 1);
    return items[idx]!;
  }

  /** Generates a pseudo-UUID string */
  uuid(): string {
    const hexChars = '0123456789abcdef';
    let res = '';
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) {
        res += '-';
      } else if (i === 14) {
        res += '4';
      } else if (i === 19) {
        res += hexChars[(this.nextInt(0, 15) & 0x3) | 0x8];
      } else {
        res += hexChars[this.nextInt(0, 15)];
      }
    }
    return res;
  }
}
