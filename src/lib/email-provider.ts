import { sendMagicLinkEmail } from '@/lib/email'

// Magic-link (passwordless email) provider, mirroring EnvoyIn's lib/email-provider.js.
// Phase 1: plain sign-in send only. Phase 3 (Team & Access) adds the invite-framing
// branch here — a not-yet-accepted membership makes this send the invite-styled email
// instead — once src/lib/members.ts is real.
export function MagicLinkProvider() {
  return {
    id: 'email',
    type: 'email' as const,
    name: 'Email',
    from: process.env.RESEND_FROM_EMAIL || 'Envoy <onboarding@resend.dev>',
    maxAge: 24 * 60 * 60,
    async sendVerificationRequest({
      identifier,
      url,
      provider,
    }: {
      identifier: string
      url: string
      provider: { from: string }
    }) {
      await sendMagicLinkEmail(identifier, url, provider.from)
    },
  }
}
