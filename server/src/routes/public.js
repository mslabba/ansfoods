'use strict';
// Public storefront API: order creation, payment session, order status.
const express = require('express');
const db = require('../db');
const products = require('../lib/products');
const settings = require('../lib/settings');
const cashfree = require('../lib/cashfree');
const { notify } = require('../lib/notify');

const router = express.Router();

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

function validateOrderBody(body) {
  const errors = [];
  const b = body || {};
  const method = b.method;
  if (method !== 'cod' && method !== 'online') errors.push('Invalid payment method.');
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) errors.push('Cart is empty.');
  const lines = [];
  for (const it of items) {
    const p = products[it && it.id];
    const qty = Number(it && it.qty);
    if (!p || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      errors.push('Invalid item in cart.');
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
    const v = validateOrderBody(req.body);
    if (v.errors.length) return res.status(400).json({ error: v.errors[0] });
    const { order, customerId } = await insertOrder(v);
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
    res.status(500).json({ error: 'Could not place the order. Please try again.' });
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
      return res.status(503).json({ error: 'Online payment is not configured yet. Please choose Cash on Delivery.' });
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
