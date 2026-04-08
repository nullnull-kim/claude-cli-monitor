// ── sanitize.ts ──
// Sanitizes external strings for safe terminal display.
// Removes control characters and ANSI escape sequences to prevent terminal injection.

const MAX_DISPLAY_LENGTH = 200;

// Matches ANSI escape sequences:
// - CSI: ESC [ ... <final byte>
// - OSC: ESC ] ... (BEL | ST)
// - DCS: ESC P ... ST  |  PM: ESC ^ ... ST  |  APC: ESC _ ... ST
// - Other ESC-based sequences (SS2, SS3, etc.)
// - 8-bit CSI (0x9B) sequences
const ANSI_ESCAPE_RE =
  /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\)|[P^_][^\x1B]*(?:\x1B\\|$)|[@-Z\\-_])|\x9B[0-?]*[ -/]*[@-~]/g;

// Matches control characters 0x00-0x1F (excluding \n which is handled separately)
// and 0x7F (DEL)
const CONTROL_CHAR_RE = /[\x00-\x09\x0B-\x1F\x7F]/g;

/**
 * Sanitizes a string for safe display in terminal output.
 *
 * Processing order:
 * 1. Remove ANSI/CSI escape sequences
 * 2. Replace \n with space
 * 3. Remove remaining control characters (0x00-0x1F excl. \n, and 0x7F)
 * 4. Normalize to NFC (prevents NFD-decomposed CJK from showing as replacement chars)
 * 5. Trim whitespace
 * 6. Truncate to MAX_DISPLAY_LENGTH (200) characters
 */
export function sanitizeDisplayString(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  let result = input;

  // Step 1: Remove ANSI escape sequences
  result = result.replace(ANSI_ESCAPE_RE, '');

  // Step 2: Replace newlines with space
  result = result.replace(/\n/g, ' ');

  // Step 3: Remove remaining control characters
  result = result.replace(CONTROL_CHAR_RE, '');

  // Step 4: Normalize to NFC (precomposed form) for consistent display
  // Prevents NFD-decomposed Korean (e.g. ㅌ+ㅔ instead of 테) from rendering as replacement chars
  result = result.normalize('NFC');

  // Step 5: Trim whitespace
  result = result.trim();

  // Step 6: Truncate to 200 characters (code point aware to avoid surrogate pair splitting)
  const codePoints = Array.from(result);
  if (codePoints.length > MAX_DISPLAY_LENGTH) {
    result = codePoints.slice(0, MAX_DISPLAY_LENGTH).join('');
  }

  return result;
}
