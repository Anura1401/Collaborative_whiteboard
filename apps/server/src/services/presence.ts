import { MAX_NAME_LENGTH } from '@whiteboard/shared';

export const PRESENCE_COLORS = [
  '#0d99ff',
  '#9333ea',
  '#16a34a',
  '#ea580c',
  '#db2777',
  '#0284c7',
  '#ca8a04',
  '#dc2626',
];

export function sanitizeDisplayName(name: string): string {
  // Remove control characters, collapse whitespace, trim, limit to MAX_NAME_LENGTH
  const noControlChars = Array.from(name)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && (code < 127 || code > 159);
    })
    .join('');

  const cleaned = noControlChars.replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, MAX_NAME_LENGTH) || 'Anonymous';
}


export function pickLeastUsedColor(usedColors: string[]): string {
  const counts = new Map<string, number>();
  for (const c of PRESENCE_COLORS) {
    counts.set(c, 0);
  }

  for (const c of usedColors) {
    if (counts.has(c)) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }

  let minCount = Infinity;
  let chosenColor = PRESENCE_COLORS[0]!;

  for (const [color, count] of counts.entries()) {
    if (count < minCount) {
      minCount = count;
      chosenColor = color;
    }
  }

  return chosenColor;
}
