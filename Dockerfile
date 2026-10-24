FROM node:20-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --prefix server --omit=dev
COPY server ./server
# Public web root: storefront + shop + admin UI + order status page
COPY *.html ./public/
COPY assets ./public/assets
COPY admin ./public/admin
ENV PUBLIC_DIR=/app/public NODE_ENV=production
EXPOSE 4000
CMD ["node", "server/src/index.js"]
