export function levenshteinDistance(source: string, target: string): number {
  if (source === target) return 0;
  if (source.length === 0) return target.length;
  if (target.length === 0) return source.length;

  const matrix = Array.from({ length: source.length + 1 }, () =>
    new Array<number>(target.length + 1).fill(0)
  );

  for (let i = 0; i <= source.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= target.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= source.length; i++) {
    for (let j = 1; j <= target.length; j++) {
      const cost = source[i - 1] === target[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[source.length][target.length];
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function scoreTwister(spoken: string, target: string): { similarity: number } {
  const normalizedTarget = normalizeText(target);
  const normalizedInput = normalizeText(spoken);

  if (normalizedTarget.length === 0 && normalizedInput.length === 0) {
    return { similarity: 100 };
  }

  if (normalizedTarget.length === 0 || normalizedInput.length === 0) {
    return { similarity: 0 };
  }

  const distance = levenshteinDistance(normalizedTarget, normalizedInput);
  const longestLength = Math.max(normalizedTarget.length, normalizedInput.length);
  const rawScore = ((longestLength - distance) / longestLength) * 100;

  return { similarity: Math.max(0, Math.round(rawScore)) };
}
