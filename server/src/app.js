'use strict';
// Express app factory (no side effects on require — testable).
const express = require('express');
const path = require('node:path');

const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, '..', '..', 'public');

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // Cashfree webhook needs the RAW body for signature verification —
  // mount it before express.json().
  app.use('/api/webhooks', express.raw({ type: 'application/json', limit: '1mb' }), require('./routes/webhook'));

  app.use(express.json({ limit: '1mb' }));
  app.use('/api', require('./routes/public'));
  app.use('/api/admin', require('./routes/admin'));

  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('unhandled:', err.message);
    res.status(500).json({ error: 'Something went wrong.' });
  });

  return app;
}

module.exports = { createApp, PUBLIC_DIR };
