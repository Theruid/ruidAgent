/**
 * Splits text into lines wrapped to maxWidth.
 * Handles newlines and word boundaries.
 */
export function wrapText(text: string, maxWidth: number): string[] {
  if (!text) return [""];
  const width = Math.max(10, maxWidth);
  const result: string[] = [];

  const rawLines = text.split(/\r?\n/);
  for (const rawLine of rawLines) {
    if (rawLine.length <= width) {
      result.push(rawLine);
      continue;
    }

    let remaining = rawLine;
    while (remaining.length > width) {
      // Look for a break point (space) within width
      let breakIdx = remaining.lastIndexOf(" ", width);
      if (breakIdx <= 0) {
        // No space found, hard cut
        breakIdx = width;
      }
      result.push(remaining.slice(0, breakIdx));
      remaining = remaining.slice(breakIdx).trimStart();
    }
    if (remaining.length > 0) {
      result.push(remaining);
    }
  }

  return result.length > 0 ? result : [""];
}
