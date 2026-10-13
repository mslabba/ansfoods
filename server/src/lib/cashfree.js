'use strict';
// Cashfree PG integration. Keys are NEVER hardcoded — they come from the
// settings table (edited in /admin/). Pure functions are exported for tests.
const crypto = require('node:crypto');

const API_VERSION = '2023-08-01';

function baseUrl(env) {
  return env === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
}

// Our display ids look like ANS-20261013-AB12; Cashfree order ids must be
// alphanumeric (letters, digits, _, -). We strip hyphens to be safe.
function toCashfreeOrderId(orderId) {
  return String(orderId).replace(/[^A-Za-z0-9_-]/g, '').replace(/-/g, '');
}

async function createOrder({ env, appId, secretKey, order, customer, appUrl }) {
  const url = `${baseUrl(env)}/pg/orders`;
  const cfOrderId = toCashfreeOrderId(order.id);
  const body = {
    order_id: cfOrderId,
    order_amount: order.amountPaise / 100,
    order_currency: 'INR',
    customer_details: {
      customer_id: `cust_${order.customerId}`,
      customer_name: customer.name,
      customer_email: customer.email || 'noemail@ansfoods.local',
      customer_phone: customer.phone,
    },
    order_meta: {
      // Cashfree appends ?order_id=<cfOrderId> to this URL after payment.
      return_url: `${appUrl}/order-status?order_id=${encodeURIComponent(order.id)}`,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': appId,
      'x-client-secret': secretKey,
      'x-api-version': API_VERSION,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.payment_session_id) {
    const msg = (data && data.message) || `Cashfree error ${res.status}`;
    throw new Error(msg);
  }
  return { paymentSessionId: data.payment_session_id, cfOrderId, raw: data };
}

async function fetchOrderStatus({ env, appId, secretKey, cfOrderId }) {
  const url = `${baseUrl(env)}/pg/orders/${encodeURIComponent(cfOrderId)}`;
  const res = await fetch(url, {
    headers: { 'x-client-id': appId, 'x-client-secret': secretKey, 'x-api-version': API_VERSION },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data && data.message) || `Cashfree error ${res.status}`);
  return data; // { order_status: 'PAID' | 'ACTIVE' | ..., ... }
}

// Webhook signature per Cashfree docs: HMAC-SHA256(secretKey, timestamp + rawBody),
// compared against the x-webhook-signature header (hex).
function verifyWebhookSignature({ rawBody, timestamp, signature, secretKey }) {
  try {
    if (!rawBody || !timestamp || !signature || !secretKey) return false;
    const payload = String(timestamp) + rawBody.toString('utf8');
    const expected = crypto.createHmac('sha256', secretKey).update(payload).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(signature), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

module.exports = { baseUrl, toCashfreeOrderId, createOrder, fetchOrderStatus, verifyWebhookSignature, API_VERSION };
