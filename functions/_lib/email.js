// functions/_lib/email.js
// Thin wrapper around the Resend HTTP API.
// Requires env.RESEND_API_KEY to be set as a Cloudflare secret.

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Send a password reset email.
 * @param {object} env  - the Pages Functions env (must contain RESEND_API_KEY, MAIL_FROM, SITE_URL)
 * @param {string} toEmail
 * @param {string} resetUrl - full URL the user clicks
 */
export async function sendPasswordResetEmail(env, toEmail, resetUrl) {
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY missing — cannot send reset email');
    return { ok: false, error: 'email_not_configured' };
  }

  const from = env.MAIL_FROM || 'Elinno Agent <noreply@elinnoagent.com>';
  const subject = 'Reset your Elinno Agent password';

  const text = [
    'Someone requested a password reset for this email address.',
    '',
    'If it was you, click the link below to set a new password:',
    resetUrl,
    '',
    'This link expires in 1 hour and can only be used once.',
    '',
    'If you did not request a reset, you can safely ignore this email.',
    '',
    '— Elinno Agent',
  ].join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f7f7f7;font-family:'Space Grotesk',system-ui,sans-serif;color:#000;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f7;padding:40px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:15px;border:1px solid #e0e0e0;padding:40px;max-width:90%;">
        <tr><td>
          <p style="margin:0 0 16px;color:#6234fc;font-size:14px;font-weight:500;letter-spacing:1.08px;text-transform:uppercase;">Elinno Agent</p>
          <h1 style="margin:0 0 24px;color:#000;font-size:28px;line-height:110%;text-transform:uppercase;font-weight:500;">Reset your password</h1>
          <p style="margin:0 0 24px;color:#4f4f4f;font-size:16px;line-height:140%;">Someone requested a password reset for this email address. If it was you, click the button below to set a new password.</p>
          <p style="margin:0 0 32px;">
            <a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#6234fc;color:#fff;text-decoration:none;padding:16px 28px;border-radius:8px;font-size:14px;font-weight:500;text-transform:uppercase;">Reset password</a>
          </p>
          <p style="margin:0 0 8px;color:#888;font-size:14px;line-height:140%;">This link expires in 1 hour and can only be used once.</p>
          <p style="margin:0;color:#888;font-size:14px;line-height:140%;">If you didn't request a reset, you can safely ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [toEmail], subject, text, html }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('Resend error', res.status, body);
      return { ok: false, error: 'send_failed' };
    }
    return { ok: true };
  } catch (err) {
    console.error('Resend network error', err);
    return { ok: false, error: 'network_error' };
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
