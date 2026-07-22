import type { DefaultSession } from 'next-auth'

// Augment the session so `session.user.id` (the lowercased-email owner id) is typed.
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
    } & DefaultSession['user']
  }
}
