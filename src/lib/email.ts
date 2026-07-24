import { Resend } from 'resend'

// Magic-link email send. Mirrors EnvoyIn's lib/email.js: the raw NextAuth callback
// URL is never put directly in the email — corporate email security gateways
// (Microsoft Defender Safe Links, Mimecast, etc.) auto-fetch every link to scan it,
// and since Auth.js completes sign-in the instant the callback URL is *fetched*
// (single-use token), that scan would burn the token before the user ever clicks.
// Instead we link to an inert /verify-email page that only navigates to the real
// callback when a human clicks "Confirm sign-in".

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

function verifyEmailUrl(rawCallbackUrl: string): string {
  const base = process.env.PUBLIC_BASE_URL || 'http://localhost:3010'
  return `${base}/verify-email?next=${encodeURIComponent(rawCallbackUrl)}`
}

export async function sendMagicLinkEmail(to: string, url: string, from: string): Promise<void> {
  const confirmUrl = verifyEmailUrl(url)
  const subject = 'Sign in to Envoy'
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#E31E24;margin:0 0 12px">Sign in to Envoy</h2>
      <p style="color:#333;line-height:1.5">Click the button below to sign in. This link is single-use and expires in 24 hours.</p>
      <p style="margin:24px 0">
        <a href="${confirmUrl}" style="background:#E31E24;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">Confirm sign-in</a>
      </p>
      <p style="color:#888;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
    </div>`

  // In local dev without a Resend key, log the confirm URL so sign-in is still testable.
  if (!resend) {
    console.log(`[email:mock] magic link for ${to}: ${confirmUrl}`)
    return
  }
  const { error } = await resend.emails.send({ from, to, subject, html })
  if (error) throw new Error(`Resend send failed: ${error.message}`)
}
