'use strict';
// Notification dispatcher. Each channel is a small module with a
// `send(event, order, customer)` function. Email is live now;
// WhatsApp (or SMS) plugs in here later as lib/channels/whatsapp.js
// without touching order or payment code.
const channels = {
  email: require('../channels/email'),
  // whatsapp: require('../channels/whatsapp'), // <-- plug in later
};

async function notify(event, order, customer) {
  const results = {};
  for (const [name, channel] of Object.entries(channels)) {
    try {
      results[name] = await channel.send(event, order, customer);
    } catch (err) {
      results[name] = { error: err.message };
    }
  }
  return results;
}

module.exports = { notify, channels };
