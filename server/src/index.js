'use strict';
// ANS Foods e-commerce backend entrypoint.
const db = require('./db');
const auth = require('./lib/auth');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT) || 4000;

async function seedAdmin() {
  const { rows } = await db.query('SELECT COUNT(*)::int AS n FROM admins');
  if (rows[0].n > 0) return;
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) {
    console.warn('No admin user exists and ADMIN_EMAIL/ADMIN_PASSWORD are not set — /admin/ login will not work until one is created.');
    return;
  }
  await db.query('INSERT INTO admins(email, password_hash) VALUES ($1, $2)', [email, auth.hashPassword(password)]);
  console.log('Seeded admin user:', email);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  await db.migrate();
  await seedAdmin();
  const app = createApp();
  app.listen(PORT, () => console.log(`ansfoods-server listening on :${PORT}`));
}

main().catch((err) => {
  console.error('startup failed:', err.message);
  process.exit(1);
});
