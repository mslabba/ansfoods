'use strict';
// Stock adjustments tied to the order lifecycle. Every function is
// idempotent via orders.stock_decremented and must run inside the
// caller's transaction (client).
//
// Lifecycle:
//  - COD order created      -> decrement immediately
//  - Online payment succeeds -> decrement (webhook / manual sync)
//  - Order cancelled        -> restore, if stock was taken
async function decrementForOrder(client, order) {
  const { rowCount } = await client.query(
    `UPDATE orders SET stock_decremented = true, updated_at = now()
     WHERE id = $1 AND stock_decremented = false`,
    [order.id]
  );
  if (!rowCount) return false; // already decremented
  for (const it of order.items || []) {
    const qty = Number(it.qty) || 0;
    if (!it.id || qty < 1) continue;
    await client.query(
      `UPDATE products SET stock = GREATEST(stock - $2, 0), updated_at = now() WHERE id = $1`,
      [it.id, qty]
    );
  }
  return true;
}

async function restoreForOrder(client, order) {
  const { rowCount } = await client.query(
    `UPDATE orders SET stock_decremented = false, updated_at = now()
     WHERE id = $1 AND stock_decremented = true`,
    [order.id]
  );
  if (!rowCount) return false; // nothing was taken
  for (const it of order.items || []) {
    const qty = Number(it.qty) || 0;
    if (!it.id || qty < 1) continue;
    await client.query(
      `UPDATE products SET stock = stock + $2, updated_at = now() WHERE id = $1`,
      [it.id, qty]
    );
  }
  return true;
}

module.exports = { decrementForOrder, restoreForOrder };
