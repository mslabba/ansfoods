'use strict';
// Server-side product catalog, backed by the `products` table.
// Prices (and stock) here are the source of truth — the checkout API
// recomputes every order total from here and never trusts amounts sent
// by the browser. Amounts in paise.
//
// Short-lived in-memory cache; the admin product API calls refresh()
// after every mutation so the storefront sees changes within seconds.
const db = require('../db');

let cache = null;
let cacheAt = 0;
const TTL_MS = 15000;

function rowToProduct(r) {
  return {
    id: r.id,
    pricePaise: r.price_paise,
    nameEn: r.name_en,
    nameMl: r.name_ml || '',
    grainEn: r.grain_en || '',
    grainMl: r.grain_ml || '',
    shortEn: r.short_en || '',
    shortMl: r.short_ml || '',
    copyEn: r.copy_en || '',
    copyMl: r.copy_ml || '',
    image: r.image || '',
    type: r.type || '',
    featured: r.featured || 0,
    stock: r.stock == null ? 0 : r.stock,
    active: !!r.active,
    benefits: normalizeBenefits(r.benefits),
  };
}

// Benefits shape: [{ titleEn, titleMl, textEn, textMl }]. Accepts the
// parsed JSONB value from pg, a JSON string, or anything else (→ []).
// Never throws — bad data degrades to "no benefits" instead of breaking
// the catalog. Items missing every field are dropped.
function normalizeBenefits(value) {
  let arr = value;
  if (typeof arr === 'string') {
    try { arr = JSON.parse(arr); } catch (e) { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const b = {
      titleEn: String(it.titleEn || '').trim(),
      titleMl: String(it.titleMl || '').trim(),
      textEn: String(it.textEn || '').trim(),
      textMl: String(it.textMl || '').trim(),
    };
    if (b.titleEn || b.titleMl || b.textEn || b.textMl) out.push(b);
  }
  return out;
}

// Strict check for admin input. Returns the cleaned array; throws an
// Error with a human-readable message on invalid input.
function validateBenefits(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('Benefits must be a list of items.');
  if (value.length > 12) throw new Error('A product can have at most 12 benefits.');
  const out = [];
  for (const it of value) {
    if (!it || typeof it !== 'object') throw new Error('Each benefit needs a title and text.');
    const b = {
      titleEn: String(it.titleEn || '').trim(),
      titleMl: String(it.titleMl || '').trim(),
      textEn: String(it.textEn || '').trim(),
      textMl: String(it.textMl || '').trim(),
    };
    if (!b.titleEn && !b.titleMl && !b.textEn && !b.textMl) continue; // blank row = removed
    if (b.titleEn.length > 120 || b.titleMl.length > 120) throw new Error('Benefit titles must be 120 characters or less.');
    if (b.textEn.length > 500 || b.textMl.length > 500) throw new Error('Benefit text must be 500 characters or less.');
    if (!b.titleEn && !b.titleMl) throw new Error('Each benefit needs a title (English or Malayalam).');
    out.push(b);
  }
  return out;
}

async function refresh() {
  const { rows } = await db.query('SELECT * FROM products ORDER BY featured ASC, id ASC');
  const map = {};
  for (const r of rows) map[r.id] = rowToProduct(r);
  cache = map;
  cacheAt = Date.now();
  return map;
}

async function getAll() {
  if (!cache || Date.now() - cacheAt > TTL_MS) await refresh();
  return cache;
}

module.exports = { getAll, refresh, rowToProduct, normalizeBenefits, validateBenefits };
