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
  };
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

module.exports = { getAll, refresh, rowToProduct };
