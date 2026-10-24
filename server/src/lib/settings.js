'use strict';
// Admin-editable settings (Cashfree keys, SMTP, alerts). All secrets live
// in the DB — nothing is hardcoded. Secrets are masked on read.
const db = require('../db');

const SECRET_KEYS = new Set(['cashfree_secret_key', 'smtp_pass']);
const ALLOWED_KEYS = new Set([
  'cashfree_app_id', 'cashfree_secret_key', 'cashfree_env',
  'alert_email', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from',
  'store_name', 'store_phone',
]);

async function getAll() {
  const { rows } = await db.query('SELECT key, value FROM settings');
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

async function getPublic() {
  const all = await getAll();
  const out = {};
  for (const key of ALLOWED_KEYS) {
    const val = all[key] || '';
    if (SECRET_KEYS.has(key)) {
      out[key] = { set: val.length > 0, masked: val.length > 4 ? '••••' + val.slice(-4) : (val ? '••••' : '') };
    } else {
      out[key] = { value: val };
    }
  }
  return out;
}

// updates: {key: value}. Empty string for a secret key keeps the existing value.
async function update(updates) {
  const changed = [];
  for (const [key, rawVal] of Object.entries(updates || {})) {
    if (!ALLOWED_KEYS.has(key)) continue;
    const value = rawVal == null ? '' : String(rawVal);
    if (SECRET_KEYS.has(key) && value === '') continue; // keep existing
    await db.query(
      `INSERT INTO settings(key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, value]
    );
    changed.push(key);
  }
  return changed;
}

module.exports = { getAll, getPublic, update, ALLOWED_KEYS, SECRET_KEYS };
