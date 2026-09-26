# ANS Foods Website

Bilingual (Malayalam / English) storefront for **ANS Foods**, a Kerala health-food brand selling millet kanji mixes.

## Products

| Product | Malayalam | Pack |
|---|---|---|
| Barnyard Millet Kanji Mix | കുതിരവാലി | 900 g — ₹600 |
| Little Millet Kanji Mix | ചാമ | 900 g — ₹600 |
| Kodo Millet Kanji Mix | വരക് | 900 g — ₹600 |

100% natural · Pure vegetarian · No added colour · No preservatives

- FSSAI: 21324159000712
- UDYAM: UDYAM-KL-01-0044310

## Features

- Malayalam/English language toggle
- Product listing with professional product photography
- Product detail views with bilingual health benefits
- Cart with quantity controls
- Bilingual checkout (customer + delivery details, order summary)
- Cash on Delivery flow — after the order is placed, a WhatsApp connect
  option (9037138030) opens with the order details prefilled
- Ayurvedic-inspired palette (botanical green, deep forest, maroon,
  terracotta, gold) with Manjari / Noto Serif Malayalam typography

## Run locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

## Deploy

Any static host works (GitHub Pages, Netlify, Cloudflare Pages, Vercel).
No build step and no backend required.

> **Note:** Online payment collection (Razorpay etc.) needs a backend for
> order creation and payment verification. The current checkout is
> Cash on Delivery with WhatsApp order confirmation.
