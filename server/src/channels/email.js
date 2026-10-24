'use strict';
// Email notification channel. SMTP config comes from admin settings at
// send time, so changes in /admin/ apply immediately — nothing hardcoded.
const nodemailer = require('nodemailer');
const settings = require('../lib/settings');

function buildTransport(s) {
  if (!s.smtp_host || !s.smtp_user) return null;
  return nodemailer.createTransport({
    host: s.smtp_host,
    port: Number(s.smtp_port) || 587,
    secure: String(s.smtp_secure).toLowerCase() === 'true',
    auth: { user: s.smtp_user, pass: s.smtp_pass || '' },
  });
}

function orderLines(order) {
  return order.items.map((it) => `• ${it.name} × ${it.qty} — ₹${((it.price_paise * it.qty) / 100).toLocaleString('en-IN')}`).join('\n');
}

function subjectFor(event, order, s) {
  const store = s.store_name || 'ANS Foods';
  if (event === 'order_cod') return `[${store}] New COD order ${order.id} — ₹${(order.amount_paise / 100).toLocaleString('en-IN')}`;
  if (event === 'payment_success') return `[${store}] Payment received — order ${order.id}`;
  if (event === 'payment_failed') return `[${store}] Payment failed — order ${order.id}`;
  return `[${store}] Order update ${order.id}`;
}

async function send(event, order, customer) {
  const s = await settings.getAll();
  if (!s.alert_email) return { skipped: 'no alert_email configured' };
  const transport = buildTransport(s);
  if (!transport) return { skipped: 'SMTP not configured' };
  const amount = '₹' + (order.amount_paise / 100).toLocaleString('en-IN');
  const text =
    `${subjectFor(event, order, s)}\n\n` +
    `Order ID: ${order.id}\n` +
    `Amount: ${amount}\n` +
    `Method: ${order.method === 'cod' ? 'Cash on Delivery' : 'Online'}\n` +
    `Status: ${order.status}\n\n` +
    `Items:\n${orderLines(order)}\n\n` +
    `Customer:\n${customer.name}\n${customer.phone}${customer.email ? '\n' + customer.email : ''}\n` +
    `${customer.address}, ${customer.district} - ${customer.pincode}\n`;
  await transport.sendMail({
    from: s.smtp_from || s.smtp_user,
    to: s.alert_email,
    subject: subjectFor(event, order, s),
    text,
  });
  return { sent: true };
}

module.exports = { send };
