import bcrypt from 'bcryptjs'

// Password hashing for the credentials sign-in flow. bcrypt (not argon2/scrypt) because
// bcryptjs is pure JS — it needs no native build step, which is what makes it safe to run
// on Vercel's serverless Node runtime without a postinstall compile.
//
// SERVER ONLY. The length rule lives in lib/password-rules.ts so client forms can import
// it without dragging bcryptjs into the browser bundle.

const ROUNDS = 12

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS)
}

// Always runs a real bcrypt comparison, even when the account has no password set
// (invited-but-not-accepted, see User.passwordHash). Returning early there would make
// "this email exists but hasn't accepted" measurably faster than "wrong password" and
// leak account state through timing, so we compare against a dummy hash instead.
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.Ns1Cg5Ea6IsBB1234567890abcdefghij'

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  const ok = await bcrypt.compare(plain, hash ?? DUMMY_HASH)
  return hash ? ok : false
}

export { MIN_PASSWORD_LENGTH, passwordProblem } from '@/lib/password-rules'
