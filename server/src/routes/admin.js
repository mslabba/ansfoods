'use strict';
// Admin API: login, orders, payment reconciliation, settings (Cashfree keys,
// SMTP, alerts), password change. All routes except login require the admin
// session cookie.
const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');
const settings = require('../lib/settings');
const cashfree = require('../lib/cashfree');

const router = express.Router();
const SESSION_SECRET = () => process.env.SESSION_SECRET || 'change-me-in-production';

function cookieFlags() {
  const secure = /^https:/i.test(process.env.APP_URL || '');
  return `HttpOnly; Path=/; SameSite=Lax; Max-Age=${7 * 24 * 3600}${secure ? '; Secure' : ''}`;
}

router.post('/login', async (req, res) => {
  try {
    const email = String((req.body || {}).email || '').trim().toLowerCase();
    const password = String((req.body || {}).password || '');
    const { rows } = await db.query('SELECT * FROM admins WHERE email = $1', [email]);
    const admin = rows[0];
    if (!admin || !auth.verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const token = auth.signToken(admin.id, SESSION_SECRET());
    res.setHeader('Set-Cookie', `${auth.COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieFlags()}`);
    res.json({ ok: true, email: admin.email });
  } catch (err) {
    console.error('admin login:', err.message);
    res.status(500).json({ error: 'Login failed.' });
  }
});

router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${auth.COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

router.use(auth.requireAdmin(SESSION_SECRET()));

router.get('/me', async (req, res) => {
  const { rows } = await db.query('SELECT email FROM admins WHERE id = $1', [req.adminId]);
  res.json({ email: rows[0] ? rows[0].email : null });
});

router.get('/orders', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const { rows } = await db.query(
      `SELECT o.id, o.amount_paise, o.method, o.status, o.created_at,
              c.name AS customer_name, c.phone AS customer_phone
       FROM orders o JOIN customers c ON c.id = o.customer_id
       ORDER BY o.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const { rows: cnt } = await db.query('SELECT COUNT(*)::int AS n FROM orders');
    res.json({ orders: rows, total: cnt[0].n });
  } catch (err) {
    console.error('admin orders:', err.message);
    res.status(500).json({ error: 'Could not load orders.' });
  }
});

router.get('/orders/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, c.email AS customer_email,
              c.address AS customer_address, c.district AS customer_district, c.pincode AS customer_pincode
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Order not found.' });
    const { rows: pays } = await db.query(
      'SELECT id, gateway, gateway_payment_id, amount_paise, status, created_at FROM payments WHERE order_id = $1 ORDER BY id DESC',
      [req.params.id]
    );
    res.json({ order: rows[0], payments: pays });
  } catch (err) {
    console.error('admin order detail:', err.message);
    res.status(500).json({ error: 'Could not load the order.' });
  }
});

const ORDER_STATUSES = new Set(['pending', 'confirmed', 'paid', 'shipped', 'cancelled', 'failed']);

router.patch('/orders/:id', async (req, res) => {
  try {
    const status = String((req.body || {}).status || '');
    if (!ORDER_STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status.' });
    const { rowCount } = await db.query(
      'UPDATE orders SET status = $2, updated_at = now() WHERE id = $1', [req.params.id, status]
    );
    if (!rowCount) return res.status(404).json({ error: 'Order not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('admin order update:', err.message);
    res.status(500).json({ error: 'Could not update the order.' });
  }
});

// Manual reconciliation: pull the latest payment status from Cashfree.
// Useful when the webhook could not reach us (e.g. no public HTTPS yet).
router.post('/orders/:id/sync-payment', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    const order = rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (!order.cf_order_id) return res.status(400).json({ error: 'No Cashfree order for this order.' });
    const s = await settings.getAll();
    if (!s.cashfree_app_id || !s.cashfree_secret_key) {
      return res.status(503).json({ error: 'Cashfree keys are not configured.' });
    }
    const cf = await cashfree.fetchOrderStatus({
      env: s.cashfree_env === 'production' ? 'production' : 'sandbox',
      appId: s.cashfree_app_id, secretKey: s.cashfree_secret_key, cfOrderId: order.cf_order_id,
    });
    const cfStatus = cf.order_status; // PAID | ACTIVE | EXPIRED | ...
    if (cfStatus === 'PAID' && order.status !== 'paid') {
      await db.query(`UPDATE orders SET status = 'paid', updated_at = now() WHERE id = $1`, [order.id]);
      await db.query(`UPDATE payments SET status = 'success' WHERE order_id = $1 AND status = 'initiated'`, [order.id]);
    }
    res.json({ orderStatus: cfStatus, marked: cfStatus === 'PAID' ? 'paid' : order.status });
  } catch (err) {
    console.error('admin sync-payment:', err.message);
    res.status(502).json({ error: 'Could not sync with Cashfree.' });
  }
});

router.get('/settings', async (req, res) => {
  try {
    res.json({ settings: await settings.getPublic() });
  } catch (err) {
    console.error('admin settings get:', err.message);
    res.status(500).json({ error: 'Could not load settings.' });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const changed = await settings.update((req.body || {}).settings || {});
    res.json({ ok: true, changed });
  } catch (err) {
    console.error('admin settings put:', err.message);
    res.status(500).json({ error: 'Could not save settings.' });
  }
});

router.post('/password', async (req, res) => {
  try {
    const current = String((req.body || {}).current || '');
    const next = String((req.body || {}).next || '');
    if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    const { rows } = await db.query('SELECT * FROM admins WHERE id = $1', [req.adminId]);
    if (!rows[0] || !auth.verifyPassword(current, rows[0].password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    await db.query('UPDATE admins SET password_hash = $2 WHERE id = $1', [req.adminId, auth.hashPassword(next)]);
    res.json({ ok: true });
  } catch (err) {
    console.error('admin password:', err.message);
    res.status(500).json({ error: 'Could not change the password.' });
  }
});

module.exports = router;
