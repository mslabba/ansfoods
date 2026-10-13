'use strict';
// Cashfree webhook receiver. Cashfree calls this server-to-server after a
// payment; we verify the HMAC signature and ONLY then mark the order paid.
// The browser is never trusted for payment confirmation.
const express = require('express');
const db = require('../db');
const settings = require('../lib/settings');
const cashfree = require('../lib/cashfree');
const stock = require('../lib/stock');
const { notify } = require('../lib/notify');

const router = express.Router();

async function markPaid(client, order, paymentData) {
  await client.query(`UPDATE orders SET status = 'paid', updated_at = now() WHERE id = $1`, [order.id]);
  await client.query(
    `UPDATE payments SET status = 'success', gateway_payment_id = $2, raw = $3 WHERE order_id = $1 AND status = 'initiated'`,
    [order.id, paymentData.payment_id || null, JSON.stringify(paymentData)]
  );
  await stock.decrementForOrder(client, order);
}

async function markFailed(client, order, paymentData) {
  await client.query(
    `UPDATE payments SET status = 'failed', raw = $2 WHERE order_id = $1 AND status = 'initiated'`,
    [order.id, JSON.stringify(paymentData)]
  );
}

// NOTE: mounted with express.raw() in index.js — req.body is a Buffer here.
router.post('/cashfree', async (req, res) => {
  // Acknowledge fast; Cashfree retries on non-2xx.
  res.status(200).json({ ok: true });
  try {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const s = await settings.getAll();
    const secretKey = s.cashfree_secret_key || '';
    if (!cashfree.verifyWebhookSignature({ rawBody: req.body, timestamp, signature, secretKey })) {
      console.error('webhook: bad signature');
      return;
    }
    const event = JSON.parse(req.body.toString('utf8'));
    const cfOrderId = event && event.data && event.data.order && event.data.order.order_id;
    const payment = event && event.data && event.data.payment;
    if (!cfOrderId || !payment) return;

    const { rows } = await db.query(
      `SELECT o.*, c.name AS cname, c.phone AS cphone, c.email AS cemail,
              c.address AS caddress, c.district AS cdistrict, c.pincode AS cpincode
       FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.cf_order_id = $1`,
      [cfOrderId]
    );
    if (!rows.length) {
      console.error('webhook: unknown order', cfOrderId);
      return;
    }
    const o = rows[0];
    if (o.status === 'paid') return; // idempotent
    const customer = { name: o.cname, phone: o.cphone, email: o.cemail, address: o.caddress, district: o.cdistrict, pincode: o.cpincode };
    const orderView = { id: o.id, items: o.items, amount_paise: o.amount_paise, method: o.method, status: o.status };

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      if (payment.payment_status === 'SUCCESS') {
        await markPaid(client, o, payment);
        await client.query('COMMIT');
        notify('payment_success', { ...orderView, status: 'paid' }, customer).catch((e) => console.error('notify failed:', e.message));
      } else if (payment.payment_status === 'FAILED' || payment.payment_status === 'USER_DROPPED') {
        await markFailed(client, o, payment);
        await client.query('COMMIT');
        notify('payment_failed', orderView, customer).catch((e) => console.error('notify failed:', e.message));
      } else {
        await client.query('ROLLBACK');
      }
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('webhook processing:', err.message);
  }
});

module.exports = router;
