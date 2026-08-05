// Password rules with NO crypto dependency, so the signed-out client forms can import
// them and validate before a round-trip without pulling bcryptjs into the browser bundle.
// The server re-checks everything here — this is a UX shortcut, never the enforcement.

export const MIN_PASSWORD_LENGTH = 10

// Deliberately light: length is the only requirement that reliably correlates with
// strength, and composition rules mostly push people toward predictable substitutions.
export function passwordProblem(plain: string): string | null {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (plain.length > 200) return 'Password must be under 200 characters.'
  return null
}
