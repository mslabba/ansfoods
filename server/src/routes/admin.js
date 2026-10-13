'use strict';
// Admin API: login, orders, payment reconciliation, settings (Cashfree keys,
// SMTP, alerts), password change. All routes except login require the admin
// session cookie.
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const multer = require('multer');
const db = require('../db');
const auth = require('../lib/auth');
const settings = require('../lib/settings');
const cashfree = require('../lib/cashfree');
const productsLib = require('../lib/products');
const stock = require('../lib/stock');

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
      `SELECT o.id, o.items, o.amount_paise, o.method, o.status, o.created_at,
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
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT id, items, status, stock_decremented FROM orders WHERE id = $1', [req.params.id]
      );
      if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Order not found.' }); }
      const order = rows[0];
      await client.query('UPDATE orders SET status = $2, updated_at = now() WHERE id = $1', [req.params.id, status]);
      if (status === 'cancelled' && order.status !== 'cancelled') {
        await stock.restoreForOrder(client, order); // no-op if stock was never taken
      }
      await client.query('COMMIT');
      if (status === 'cancelled') await productsLib.refresh().catch(() => {}); // stock may have changed
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
      const client = await db.getClient();
      try {
        await client.query('BEGIN');
        await client.query(`UPDATE orders SET status = 'paid', updated_at = now() WHERE id = $1`, [order.id]);
        await client.query(`UPDATE payments SET status = 'success' WHERE order_id = $1 AND status = 'initiated'`, [order.id]);
        await stock.decrementForOrder(client, order);
        await client.query('COMMIT');
        await productsLib.refresh().catch(() => {}); // stock changed
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
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

// ---------------- products ----------------
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, '..', '..', 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'assets', 'uploads');
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { /* ignore */ }

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || '').toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)/) || ['.jpg'])[0];
      cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed.'));
  },
});

// Upload a product image. Returns the path to store on the product.
router.post('/products/image', (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
    if (!req.file) return res.status(400).json({ error: 'No image selected.' });
    res.json({ path: 'assets/uploads/' + req.file.filename });
  });
});

function rowToAdminProduct(r) {
  const p = productsLib.rowToProduct(r);
  return { ...p, createdAt: r.created_at, updatedAt: r.updated_at };
}

router.get('/products', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM products ORDER BY featured ASC, id ASC');
    res.json({ products: rows.map(rowToAdminProduct) });
  } catch (err) {
    console.error('admin products list:', err.message);
    res.status(500).json({ error: 'Could not load products.' });
  }
});

const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
function validateProductInput(b, isCreate) {
  const errors = [];
  const need = (cond, msg) => { if (cond) errors.push(msg); };
  if (isCreate || b.id !== undefined) need(!ID_RE.test(String(b.id || '')), 'ID must be a URL-safe slug, e.g. "foxtail-mix" (letters, numbers, hyphens).');
  if (isCreate || b.name_en !== undefined) need(String(b.name_en || '').trim().length < 2, 'English name is required.');
  if (b.price !== undefined) {
    const price = Number(b.price);
    need(!Number.isFinite(price) || price < 0 || price > 1000000, 'Price must be a valid rupee amount.');
  } else if (isCreate) errors.push('Price is required.');
  if (b.stock !== undefined) {
    const s = Number(b.stock);
    need(!Number.isInteger(s) || s < 0 || s > 1000000, 'Stock must be a whole number (0 or more).');
  }
  if (b.featured !== undefined) {
    need(!Number.isInteger(Number(b.featured)), 'Sort order must be a whole number.');
  }
  if (b.image !== undefined) need(String(b.image || '').length > 500, 'Image path is too long.');
  return errors;
}

router.post('/products', async (req, res) => {
  try {
    const b = req.body || {};
    const errors = validateProductInput(b, true);
    if (!String(b.image || '').trim()) errors.push('A product image is required — upload one or paste an image path.');
    if (errors.length) return res.status(400).json({ error: errors[0] });
    const id = String(b.id).trim().toLowerCase();
    try {
      const { rows } = await db.query(
        `INSERT INTO products
           (id, name_en, name_ml, grain_en, grain_ml, short_en, short_ml, copy_en, copy_ml,
            price_paise, image, type, featured, stock, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING *`,
        [id,
         String(b.name_en).trim(), String(b.name_ml || '').trim(),
         String(b.grain_en || '').trim(), String(b.grain_ml || '').trim(),
         String(b.short_en || '').trim(), String(b.short_ml || '').trim(),
         String(b.copy_en || '').trim(), String(b.copy_ml || '').trim(),
         Math.round(Number(b.price) * 100), String(b.image).trim(),
         String(b.type || '').trim().toLowerCase(), Number(b.featured) || 0,
         Number(b.stock) || 0, b.active !== false]
      );
      await productsLib.refresh();
      res.status(201).json({ product: rowToAdminProduct(rows[0]) });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'A product with this ID already exists.' });
      throw err;
    }
  } catch (err) {
    console.error('admin product create:', err.message);
    res.status(500).json({ error: 'Could not create the product.' });
  }
});

router.put('/products/:id', async (req, res) => {
  try {
    const b = req.body || {};
    const errors = validateProductInput(b, false);
    if (errors.length) return res.status(400).json({ error: errors[0] });
    const sets = [];
    const params = [];
    const push = (col, val) => { params.push(val); sets.push(col + ' = $' + params.length); };
    if (b.name_en !== undefined) push('name_en', String(b.name_en).trim());
    if (b.name_ml !== undefined) push('name_ml', String(b.name_ml).trim());
    if (b.grain_en !== undefined) push('grain_en', String(b.grain_en).trim());
    if (b.grain_ml !== undefined) push('grain_ml', String(b.grain_ml).trim());
    if (b.short_en !== undefined) push('short_en', String(b.short_en).trim());
    if (b.short_ml !== undefined) push('short_ml', String(b.short_ml).trim());
    if (b.copy_en !== undefined) push('copy_en', String(b.copy_en).trim());
    if (b.copy_ml !== undefined) push('copy_ml', String(b.copy_ml).trim());
    if (b.price !== undefined) push('price_paise', Math.round(Number(b.price) * 100));
    if (b.image !== undefined) {
      if (!String(b.image).trim()) return res.status(400).json({ error: 'A product image is required.' });
      push('image', String(b.image).trim());
    }
    if (b.type !== undefined) push('type', String(b.type).trim().toLowerCase());
    if (b.featured !== undefined) push('featured', Number(b.featured) || 0);
    if (b.stock !== undefined) push('stock', Number(b.stock) || 0);
    if (b.active !== undefined) push('active', !!b.active);
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
    push('updated_at', new Date());
    params.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE products SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Product not found.' });
    await productsLib.refresh();
    res.json({ product: rowToAdminProduct(rows[0]) });
  } catch (err) {
    console.error('admin product update:', err.message);
    res.status(500).json({ error: 'Could not update the product.' });
  }
});

// "Delete" hides the product from the shop (soft delete); it can be restored.
// Order history is unaffected — orders keep their own item snapshots.
router.delete('/products/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query(
      `UPDATE products SET active = false, updated_at = now() WHERE id = $1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Product not found.' });
    await productsLib.refresh();
    res.json({ ok: true });
  } catch (err) {
    console.error('admin product delete:', err.message);
    res.status(500).json({ error: 'Could not delete the product.' });
  }
});

router.post('/products/:id/restore', async (req, res) => {
  try {
    const { rowCount } = await db.query(
      `UPDATE products SET active = true, updated_at = now() WHERE id = $1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Product not found.' });
    await productsLib.refresh();
    res.json({ ok: true });
  } catch (err) {
    console.error('admin product restore:', err.message);
    res.status(500).json({ error: 'Could not restore the product.' });
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
