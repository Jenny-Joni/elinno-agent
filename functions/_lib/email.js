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

/**
 * Block 10.2 decision H: send a per-project AI cost-cap notification
 * to all admins of a project. Two flavors:
 *   - kind='warning' fires at >=80% of cap
 *   - kind='paused'  fires at >=100% of cap (AI paused for the month)
 * Idempotent per (project, month) via projects.ai_cap_warned_at —
 * caller updates that column after a successful send to suppress
 * subsequent fires in the same month.
 *
 * Each admin gets their own one-recipient send (Resend allows array-
 * to but separate sends mean a delivery failure for one admin doesn't
 * mask a success for another in our logs).
 *
 * @param {object} env
 * @param {string} projectName
 * @param {number} capUsd       - the project's monthly cap
 * @param {number} usedUsd      - the project's month-to-date spend
 * @param {'warning'|'paused'} kind
 * @param {string[]} adminEmails - per getAdminEmailsForProject
 * @returns {Promise<{ ok: boolean, sent: number, failed: number, error?: string }>}
 */
export async function sendCostCapEmail(env, projectName, capUsd, usedUsd, kind, adminEmails) {
  if (!env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY missing — cannot send cost-cap email');
    return { ok: false, sent: 0, failed: 0, error: 'email_not_configured' };
  }
  if (!Array.isArray(adminEmails) || adminEmails.length === 0) {
    return { ok: true, sent: 0, failed: 0 };
  }
  if (kind !== 'warning' && kind !== 'paused') {
    return { ok: false, sent: 0, failed: 0, error: 'invalid_kind' };
  }

  const from = env.MAIL_FROM || 'Elinno Agent <noreply@elinnoagent.com>';
  const siteUrl = env.SITE_URL || 'https://elinnoagent.com';
  const safeProject = escapeHtml(projectName || 'your project');
  const usedFmt = capUsd > 0 ? `$${usedUsd.toFixed(2)} of $${capUsd.toFixed(2)}` : `$${usedUsd.toFixed(2)}`;

  const subject = kind === 'paused'
    ? `[Elinno Agent] AI paused for ${projectName} — monthly budget reached`
    : `[Elinno Agent] ${projectName} at 80% of its monthly AI budget`;

  const heading = kind === 'paused' ? 'AI paused for this project' : 'Approaching your monthly AI budget';
  const bodyCopy = kind === 'paused'
    ? `${safeProject} has used ${usedFmt} this month, which has reached the configured cap. AI responses are paused for this project until the budget resets at the start of next month. Existing data and connections are unaffected.`
    : `${safeProject} has used ${usedFmt} of its configured AI budget this month. You'll be notified again if usage hits 100% (at which point AI responses pause until the budget resets next month).`;

  const text = [
    heading,
    '',
    bodyCopy,
    '',
    `Project: ${projectName}`,
    `Month-to-date AI cost: ${usedFmt}`,
    '',
    `Open the project: ${siteUrl}`,
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
          <h1 style="margin:0 0 24px;color:#000;font-size:28px;line-height:110%;text-transform:uppercase;font-weight:500;">${escapeHtml(heading)}</h1>
          <p style="margin:0 0 24px;color:#4f4f4f;font-size:16px;line-height:140%;">${escapeHtml(bodyCopy)}</p>
          <p style="margin:0 0 8px;color:#000;font-size:14px;line-height:140%;"><strong>Project:</strong> ${safeProject}</p>
          <p style="margin:0 0 32px;color:#000;font-size:14px;line-height:140%;"><strong>Month-to-date AI cost:</strong> ${escapeHtml(usedFmt)}</p>
          <p style="margin:0 0 8px;">
            <a href="${escapeHtml(siteUrl)}" style="display:inline-block;background:#6234fc;color:#fff;text-decoration:none;padding:16px 28px;border-radius:8px;font-size:14px;font-weight:500;text-transform:uppercase;">Open Elinno Agent</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  let sent = 0;
  let failed = 0;
  for (const toEmail of adminEmails) {
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
        console.error('Resend cost-cap error', kind, toEmail, res.status, body);
        failed++;
        continue;
      }
      sent++;
    } catch (err) {
      console.error('Resend cost-cap network error', kind, toEmail, err);
      failed++;
    }
  }
  return { ok: sent > 0, sent, failed };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
