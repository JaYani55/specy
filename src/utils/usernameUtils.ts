/**
 * Shared username rules for `user_profile.Username` (the public display name).
 *
 * The column carries a UNIQUE constraint and is used display-only across the
 * app (profile headers, staff lists, e-mail recipient labels; AuthContext
 * derives first/last name by splitting on spaces — which any value matching
 * the rules below satisfies). Keep the rules in sync with the database and
 * always edit usernames through this validator.
 */

export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 50;

// Letters, numbers, literal spaces, hyphens and underscores — same character
// set the profile page has always enforced, but with \s narrowed to the plain
// space character: AuthContext derives first/last name via split(' '), so
// tabs/newlines in the value would corrupt that derivation.
export const USERNAME_PATTERN = /^[a-zA-Z0-9_ -]+$/;

export interface UsernameRuleError {
  en: string;
  de: string;
}

/**
 * Validates a candidate username. Returns the rule violation (already
 * localized-ready) or null when the value is valid.
 */
export const validateUsername = (value: string): UsernameRuleError | null => {
  const trimmed = value.trim();

  if (trimmed.length < USERNAME_MIN_LENGTH) {
    return {
      en: `The username must be at least ${USERNAME_MIN_LENGTH} characters long.`,
      de: `Der Anzeigename muss mindestens ${USERNAME_MIN_LENGTH} Zeichen lang sein.`,
    };
  }
  if (trimmed.length > USERNAME_MAX_LENGTH) {
    return {
      en: `The username must not exceed ${USERNAME_MAX_LENGTH} characters.`,
      de: `Der Anzeigename darf maximal ${USERNAME_MAX_LENGTH} Zeichen lang sein.`,
    };
  }
  if (!USERNAME_PATTERN.test(trimmed)) {
    return {
      en: 'The username may only contain letters, numbers, spaces, hyphens and underscores.',
      de: 'Der Anzeigename darf nur Buchstaben, Zahlen, Leerzeichen, Bindestriche und Unterstriche enthalten.',
    };
  }
  return null;
};

/**
 * True when a Supabase/Postgres error is a UNIQUE violation on the username
 * (the column has no other unique constraints).
 */
export const isUsernameTakenError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string; message?: string };
  if (candidate.code === '23505') return true;
  return typeof candidate.message === 'string'
    && (candidate.message.includes('user_profile_username_key')
      || (candidate.message.includes('duplicate key') && candidate.message.includes('Username')));
};
