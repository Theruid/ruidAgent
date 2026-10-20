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

/**
 * Truncates a single line to fit `max` terminal cells, appending an ellipsis.
 * Uses code points so surrogate pairs and braille/emoji glyphs are not split.
 */
export function truncateLine(text: string, max: number): string {
  if (max <= 0) return "";
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  if (max <= 1) return "…";
  return chars.slice(0, max - 1).join("") + "…";
}
