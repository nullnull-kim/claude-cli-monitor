/**
 * i18n entry point. English-only.
 */

import { en } from './en.js';
import type { Translations } from './types.js';

export type { Translations } from './types.js';

/** Get translations. English-only build. */
export function getTranslations(): Translations {
  return en;
}

/**
 * Simple %s / %d placeholder replacement.
 */
export function t(template: string, ...args: (string | number)[]): string {
  let i = 0;
  return template.replace(/%[sd]/g, () => String(args[i++] ?? ''));
}
