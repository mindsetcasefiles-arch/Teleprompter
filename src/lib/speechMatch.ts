/** Normalize a spoken or script word for fuzzy matching. */
export function cleanWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, '')
    .trim();
}

/**
 * Advance the script cursor based on recent speech recognition tokens.
 * Searches a small lookahead window so skipped or misheard words do not
 * yank the teleprompter backwards.
 */
export function matchSpokenToScript(
  scriptWords: string[],
  recentSpoken: string[],
  lastMatchedIndex: number
): number {
  let currentScriptIndex = Math.max(0, lastMatchedIndex - 5);
  let matchedIndex = lastMatchedIndex;

  for (const spoken of recentSpoken) {
    const cleanSpoken = cleanWord(spoken);
    if (!cleanSpoken) continue;

    for (let lookahead = 0; lookahead < 15; lookahead++) {
      const checkIndex = currentScriptIndex + lookahead;
      if (checkIndex >= scriptWords.length) break;

      const cleanScript = cleanWord(scriptWords[checkIndex]);
      if (!cleanScript) continue;

      const exact = cleanScript === cleanSpoken;
      const contains =
        cleanSpoken.includes(cleanScript) || cleanScript.includes(cleanSpoken);
      const prefix =
        cleanScript.length > 3 &&
        cleanSpoken.startsWith(cleanScript.slice(0, 4));

      if (exact || contains || prefix) {
        matchedIndex = checkIndex;
        currentScriptIndex = checkIndex + 1;
        break;
      }
    }
  }

  return matchedIndex;
}

export function tokenizeSpeech(spokenWords: string, interim: string): string[] {
  return `${spokenWords} ${interim}`
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}
