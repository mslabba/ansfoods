'use strict';
// Password hashing (scrypt) + HMAC-signed admin session tokens.
// No external dependencies — pure node:crypto.
const crypto = require('node:crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored).split(':');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const [, salt, hash] = parts;
    const check = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(check, Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

const COOKIE_NAME = 'ans_admin';

function signToken(adminId, secret) {
  const exp = Date.now() + 7 * 24 * 3600 * 1000; // 7 days
  const data = `${adminId}.${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  return Buffer.from(`${data}.${sig}`, 'utf8').toString('base64url');
}

function verifyToken(token, secret) {
  try {
    const [id, exp, sig] = Buffer.from(String(token), 'base64url').toString('utf8').split('.');
    if (!id || !exp || !sig || Date.now() > Number(exp)) return null;
    const expected = crypto.createHmac('sha256', secret).update(`${id}.${exp}`).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8'))) return null;
    return { id: Number(id) };
  } catch {
    return null;
  }
}

function getCookie(req, name) {
  const header = req.headers.cookie || '';
  const m = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function requireAdmin(secret) {
  return (req, res, next) => {
    const token = getCookie(req, COOKIE_NAME);
    const admin = token && verifyToken(token, secret);
    if (!admin) return res.status(401).json({ error: 'Not signed in.' });
    req.adminId = admin.id;
    next();
  };
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, getCookie, requireAdmin, COOKIE_NAME };
