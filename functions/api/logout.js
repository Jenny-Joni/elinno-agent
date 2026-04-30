// functions/api/logout.js
import {
  SESSION_COOKIE,
  buildClearCookie,
  deleteSession,
  getCookie,
  json,
} from '../_lib/auth.js';

export async function onRequestPost({ request, env }) {
  const token = getCookie(request, SESSION_COOKIE);
  await deleteSession(env.DB, token);
  return json({ ok: true }, { headers: { 'Set-Cookie': buildClearCookie() } });
}
