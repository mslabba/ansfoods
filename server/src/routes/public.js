'use strict';
// Public storefront API: order creation, payment session, order status.
const express = require('express');
const db = require('../db');
const productsLib = require('../lib/products');
const stock = require('../lib/stock');
const settings = require('../lib/settings');
const cashfree = require('../lib/cashfree');
const { notify } = require('../lib/notify');

const router = express.Router();

// Cash on Delivery is off unless ENABLE_COD=true is set in the environment.
// The storefront reads /api/config to decide whether to show the COD option.
function codEnabled() {
  return String(process.env.ENABLE_COD || '').toLowerCase() === 'true';
}

router.get('/config', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ cod: codEnabled() });
});

function generateOrderId() {
  const d = new Date();
  const ymd = d.getFullYear()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, 'X');
  return `ANS-${ymd}-${rand}`;
}

function cleanPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

async function validateOrderBody(body) {
  const errors = [];
  const b = body || {};
  const method = b.method;
  if (method !== 'cod' && method !== 'online') errors.push('Invalid payment method.');
  else if (method === 'cod' && !codEnabled()) errors.push('Cash on Delivery is currently unavailable. Please pay online.');
  const products = await productsLib.getAll();
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) errors.push('Cart is empty.');
  const lines = [];
  for (const it of items) {
    const p = products[it && it.id];
    const qty = Number(it && it.qty);
    if (!p || !p.active || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      errors.push('Invalid item in cart.');
      continue;
    }
    if (p.stock <= 0) {
      errors.push('Sorry, ' + p.nameEn + ' is out of stock.');
      continue;
    }
    if (qty > p.stock) {
      errors.push('Only ' + p.stock + ' × ' + p.nameEn + ' available right now.');
      continue;
    }
    lines.push({ id: it.id, qty, price_paise: p.pricePaise, name: p.nameEn });
  }
  const c = b.customer || {};
  const name = String(c.name || '').trim();
  const phone = cleanPhone(c.phone);
  const email = String(c.email || '').trim();
  const address = String(c.address || '').trim();
  const district = String(c.district || '').trim();
  const pincode = String(c.pincode || '').replace(/\D/g, '');
  if (name.length < 2) errors.push('Please enter your full name.');
  if (!phone) errors.push('Please enter a valid 10-digit mobile number.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Please enter a valid email address.');
  if (address.length < 6) errors.push('Please enter your delivery address.');
  if (!district) errors.push('Please enter your district.');
  if (!/^\d{6}$/.test(pincode)) errors.push('Please enter a valid 6-digit PIN code.');
  const amountPaise = lines.reduce((s, l) => s + l.price_paise * l.qty, 0);
  if (!amountPaise) errors.push('Cart is empty.');
  return {
    errors,
    method,
    lines,
    amountPaise,
    customer: { name, phone, email, address, district, pincode },
  };
}

async function insertOrder(v) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { rows: custRows } = await client.query(
      `INSERT INTO customers(name, phone, email, address, district, pincode)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [v.customer.name, v.customer.phone, v.customer.email, v.customer.address, v.customer.district, v.customer.pincode]
    );
    const customerId = custRows[0].id;
    let orderId = null;
    for (let i = 0; i < 5 && !orderId; i++) {
      const candidate = generateOrderId();
      try {
        await client.query(
          `INSERT INTO orders(id, customer_id, items, amount_paise, method, status)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [candidate, customerId, JSON.stringify(v.lines), v.amountPaise, v.method,
           v.method === 'cod' ? 'confirmed' : 'pending']
        );
        orderId = candidate;
      } catch (err) {
        if (err.code !== '23505') throw err; // retry only on id collision
      }
    }
    if (!orderId) throw new Error('Could not generate order id.');
    if (v.method === 'cod') {
      // Take the items out of stock atomically; a concurrent order winning
      // the race makes this update a no-op and we abort with 409.
      for (const l of v.lines) {
        const { rowCount } = await client.query(
          `UPDATE products SET stock = stock - $2, updated_at = now()
           WHERE id = $1 AND stock >= $2`,
          [l.id, l.qty]
        );
        if (!rowCount) {
          const conflict = new Error('Stock changed while placing the order.');
          conflict.statusCode = 409;
          throw conflict;
        }
      }
      await client.query(`UPDATE orders SET stock_decremented = true WHERE id = $1`, [orderId]);
    }
    await client.query('COMMIT');
    const { rows } = await client.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    return { order: rows[0], customerId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// POST /api/orders — create an order (server recomputes the total).
router.post('/orders', async (req, res) => {
  try {
    const v = await validateOrderBody(req.body);
    if (v.errors.length) return res.status(400).json({ error: v.errors[0] });
    const { order, customerId } = await insertOrder(v);
    if (v.method === 'cod') await productsLib.refresh().catch(() => {}); // stock changed
    const fullOrder = { ...order, items: v.lines };
    if (v.method === 'cod') {
      notify('order_cod', fullOrder, { ...v.customer }).catch((e) => console.error('notify failed:', e.message));
    }
    res.status(201).json({
      orderId: order.id,
      amountPaise: order.amount_paise,
      amount: order.amount_paise / 100,
      status: order.status,
    });
  } catch (err) {
    console.error('POST /api/orders:', err.message);
    if (err.statusCode === 409) {
      return res.status(409).json({ error: 'Some items just went out of stock. Please review your cart and try again.' });
    }
    res.status(500).json({ error: 'Could not place the order. Please try again.' });
  }
});

// GET /api/products — public catalog for the storefront (active products only).
router.get('/products', async (req, res) => {
  try {
    const all = await productsLib.getAll();
    const list = Object.values(all)
      .filter((p) => p.active)
      .sort((a, b) => a.featured - b.featured)
      .map((p) => ({
        id: p.id,
        nameEn: p.nameEn, nameMl: p.nameMl,
        grainEn: p.grainEn, grainMl: p.grainMl,
        shortEn: p.shortEn, shortMl: p.shortMl,
        copyEn: p.copyEn, copyMl: p.copyMl,
        image: p.image, type: p.type, featured: p.featured,
        stock: p.stock,
        pricePaise: p.pricePaise, price: p.pricePaise / 100,
      }));
    res.json({ products: list });
  } catch (err) {
    console.error('GET /api/products:', err.message);
    res.status(500).json({ error: 'Could not load products.' });
  }
});

// GET /api/orders/:id — public order status (for the confirmation page).
router.get('/orders/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, items, amount_paise, method, status, created_at FROM orders WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Order not found.' });
    const o = rows[0];
    res.json({
      id: o.id,
      items: o.items,
      amountPaise: o.amount_paise,
      amount: o.amount_paise / 100,
      method: o.method,
      status: o.status,
      createdAt: o.created_at,
    });
  } catch (err) {
    console.error('GET /api/orders/:id:', err.message);
    res.status(500).json({ error: 'Could not fetch the order.' });
  }
});

// POST /api/payments/session — start a Cashfree payment for a pending order.
router.post('/payments/session', async (req, res) => {
  try {
    const orderId = String((req.body || {}).orderId || '');
    const { rows } = await db.query(
      `SELECT o.*, c.name AS cname, c.phone AS cphone, c.email AS cemail
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`,
      [orderId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Order not found.' });
    const o = rows[0];
    if (o.method !== 'online') return res.status(400).json({ error: 'This order is Cash on Delivery.' });
    if (o.status !== 'pending') return res.status(400).json({ error: 'This order is already processed.' });

    const s = await settings.getAll();
    const appId = s.cashfree_app_id || '';
    const secretKey = s.cashfree_secret_key || '';
    const env = s.cashfree_env === 'production' ? 'production' : 'sandbox';
    if (!appId || !secretKey) {
      return res.status(503).json({ error: codEnabled() ? 'Online payment is not configured yet. Please choose Cash on Delivery.' : 'Online payment is temporarily unavailable. Please try again later.' });
    }
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '') || `http://localhost:${process.env.PORT || 4000}`;
    const session = await cashfree.createOrder({
      env, appId, secretKey,
      order: { id: o.id, amountPaise: o.amount_paise, customerId: o.customer_id },
      customer: { name: o.cname, email: o.cemail, phone: o.cphone },
      appUrl,
    });
    await db.query(
      `INSERT INTO payments(order_id, gateway, gateway_order_id, amount_paise, status, raw)
       VALUES ($1,'cashfree',$2,$3,'initiated',$4)`,
      [o.id, session.cfOrderId, o.amount_paise, JSON.stringify({ payment_session_id: !!session.paymentSessionId })]
    );
    await db.query('UPDATE orders SET cf_order_id = $2, updated_at = now() WHERE id = $1', [o.id, session.cfOrderId]);
    res.json({ paymentSessionId: session.paymentSessionId, environment: env, cfOrderId: session.cfOrderId });
  } catch (err) {
    console.error('POST /api/payments/session:', err.message);
    res.status(502).json({ error: 'Could not start the payment. Please try again.' });
  }
});

module.exports = router;
