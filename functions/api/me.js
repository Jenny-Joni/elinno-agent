// functions/api/me.js
import { getSessionUser, json } from '../_lib/auth.js';

export async function onRequestGet({ request, env }) {
  const user = await getSessionUser(request, env.DB);
  if (!user) return json({ user: null }, { status: 200 });
  return json({
    user: { id: user.id, email: user.email, is_admin: !!user.is_admin },
  });
}
