#!/usr/bin/env node
// scripts/seed-admin.mjs
// Generates a one-line SQL INSERT to seed the first admin user.
//
// Usage:
//   node scripts/seed-admin.mjs <email> <password>
//
// Then copy the printed SQL and run it with wrangler:
//   npx wrangler d1 execute elinno-agent-db --remote --command "<paste the SQL here>"

import { webcrypto as crypto } from 'node:crypto';

const ITERATIONS = 310_000;

async function pbkdf2(password, salt, iterations, byteLength = 32) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    byteLength * 8
  );
  return new Uint8Array(bits);
}

function b64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function hashPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

const [, , emailArg, passwordArg] = process.argv;
if (!emailArg || !passwordArg) {
  console.error('Usage: node scripts/seed-admin.mjs <email> <password>');
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();
const hash = await hashPassword(passwordArg);
const now = Math.floor(Date.now() / 1000);

// Single-quoted SQL; password hash never contains a single quote (b64 only).
const sql =
  `INSERT INTO users (email, password_hash, is_admin, created_at, updated_at) ` +
  `VALUES ('${email}', '${hash}', 1, ${now}, ${now});`;

console.log('\n--- Run this command (one line):\n');
console.log(`npx wrangler d1 execute elinno-agent-db --remote --command "${sql.replace(/"/g, '\\"')}"`);
console.log('\n--- Or just the SQL, if you prefer to paste it into the dashboard:\n');
console.log(sql);
console.log('');
