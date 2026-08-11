import { Resend } from 'resend'

// Transactional email for the two password flows: an invited employee setting their first
// password, and an existing user resetting a forgotten one.
//
// Unlike the magic-link flow this replaced, these links are inert until submitted — they
// open a form rather than completing an action on GET. Email security gateways (Microsoft
// Defender Safe Links, Mimecast) pre-fetch every link they see, which used to burn
// single-use sign-in tokens before the recipient ever clicked. A link that only renders a
// page is immune to that, so the old /verify-email interstitial is no longer needed.

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL || 'Envoy <onboarding@resend.dev>'
}

const BRAND = '#E31E24'

function shell(heading: string, bodyHtml: string, ctaLabel: string, ctaUrl: string): string {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:${BRAND};margin:0 0 12px">${heading}</h2>
      ${bodyHtml}
      <p style="margin:24px 0">
        <a href="${ctaUrl}" style="background:${BRAND};color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:600">${ctaLabel}</a>
      </p>
      <p style="color:#888;font-size:13px">If the button doesn't work, paste this into your browser:<br><span style="word-break:break-all">${ctaUrl}</span></p>
    </div>`
}

async function send(to: string, subject: string, html: string, debugLabel: string, url: string) {
  // No key configured — local dev only. Log the link so the flow stays testable E2E.
  if (!resend) {
    console.log(`[email:mock] ${debugLabel} for ${to}: ${url}`)
    return
  }
  const { error } = await resend.emails.send({ from: fromAddress(), to, subject, html })
  if (error) throw new Error(`Resend send failed: ${error.message}`)
}

// Sent when an admin adds someone to the team. The recipient has a User row but no
// password yet — this link is the only way they can get one.
export async function sendInviteEmail(
  to: string,
  url: string,
  opts: { businessName?: string | null; invitedBy?: string | null; role?: string }
): Promise<void> {
  const company = opts.businessName?.trim() || 'a company'
  const inviter = opts.invitedBy ? ` by ${opts.invitedBy}` : ''
  const role = opts.role ? ` as <strong>${opts.role}</strong>` : ''
  const html = shell(
    `You've been invited to ${company}`,
    `<p style="color:#333;line-height:1.5">You were added to the <strong>${company}</strong> workspace on Envoy${inviter}${role}. Choose a password to finish setting up your account.</p>
     <p style="color:#333;line-height:1.5">This invite expires in 7 days.</p>`,
    'Set your password',
    url
  )
  await send(to, `You've been invited to ${company} on Envoy`, html, 'invite link', url)
}

export async function sendPasswordResetEmail(to: string, url: string): Promise<void> {
  const html = shell(
    'Reset your password',
    `<p style="color:#333;line-height:1.5">Click below to choose a new password for your Envoy account. This link is single-use and expires in 1 hour.</p>
     <p style="color:#888;font-size:13px">If you didn't request this, you can safely ignore this email — your password won't change.</p>`,
    'Choose a new password',
    url
  )
  await send(to, 'Reset your Envoy password', html, 'password reset link', url)
}
