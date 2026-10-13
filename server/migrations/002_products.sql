-- Product catalog: managed from the admin panel (list / add / edit /
-- delete / stock). Prices here are the source of truth for order totals.
CREATE TABLE IF NOT EXISTS products (
  id           TEXT PRIMARY KEY,
  name_en      TEXT NOT NULL,
  name_ml      TEXT NOT NULL DEFAULT '',
  grain_en     TEXT NOT NULL DEFAULT '',
  grain_ml     TEXT NOT NULL DEFAULT '',
  short_en     TEXT NOT NULL DEFAULT '',
  short_ml     TEXT NOT NULL DEFAULT '',
  copy_en      TEXT NOT NULL DEFAULT '',
  copy_ml      TEXT NOT NULL DEFAULT '',
  price_paise  INTEGER NOT NULL CHECK (price_paise >= 0),
  image        TEXT NOT NULL DEFAULT '',
  type         TEXT NOT NULL DEFAULT '',
  featured     INTEGER NOT NULL DEFAULT 0,
  stock        INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_active_featured_idx ON products (active, featured);

-- Seed the launch range (only on a fresh table).
INSERT INTO products
  (id, name_en, name_ml, grain_en, grain_ml, short_en, short_ml, copy_en, copy_ml,
   price_paise, image, type, featured, stock, active)
SELECT * FROM (VALUES
  ('barnyard',
   'Barnyard Millet Kanji Mix', 'കുതിരവാലി മില്ലറ്റ് കഞ്ഞി മിക്സ്',
   'Barnyard millet', 'കുതിരവാലി',
   'A naturally hearty grain blend with a light, comforting finish.',
   'ലളിതവും ഹൃദ്യവുമായ രുചിയുള്ള നാടൻ ധാന്യ മിശ്രിതം.',
   'A naturally hearty grain blend with a light, comforting finish—made for a warm and wholesome everyday bowl.',
   'ലളിതവും ഹൃദ്യവുമായ രുചിയോടെ, ദിവസവും ഒരു ഊഷ്മളവും പോഷകസമൃദ്ധവുമായ കഞ്ഞി തയ്യാറാക്കാൻ അനുയോജ്യമായ നാടൻ ധാന്യ മിശ്രിതം.',
   60000, 'assets/ans-barnyard-pro.jpg', 'barnyard', 1, 100, TRUE),
  ('little',
   'Little Millet Kanji Mix', 'ചാമ മില്ലറ്റ് കഞ്ഞി മിക്സ്',
   'Little millet', 'ചാമ',
   'A gentle everyday millet blend with a familiar, satisfying texture.',
   'പരിചിതമായ രുചിയും സംതൃപ്തമായ ഘടനയുമുള്ള ദൈനംദിന മില്ലറ്റ് മിശ്രിതം.',
   'A gentle everyday millet blend with a familiar, satisfying texture—an uncomplicated choice for your breakfast table.',
   'പരിചിതമായ രുചിയും സംതൃപ്തമായ ഘടനയുമുള്ള ദൈനംദിന മില്ലറ്റ് മിശ്രിതം—പ്രഭാതഭക്ഷണത്തിന് ലളിതമായൊരു തിരഞ്ഞെടുപ്പ്.',
   60000, 'assets/ans-little-pro.jpg', 'little', 2, 100, TRUE),
  ('kodo',
   'Kodo Millet Kanji Mix', 'വരക് മില്ലറ്റ് കഞ്ഞി മിക്സ്',
   'Kodo millet', 'വരക്',
   'A robust traditional grain blend for a warm, wholesome bowl.',
   'ഊഷ്മളവും പോഷകസമൃദ്ധവുമായ കഞ്ഞിക്കായി നാടൻ ധാന്യ മിശ്രിതം.',
   'A robust traditional grain blend for a warm, wholesome bowl with a satisfying, homestyle character.',
   'ഊഷ്മളവും പോഷകസമൃദ്ധവുമായ കഞ്ഞിക്കായി, നാടൻ രുചിയോടെ തയ്യാറാക്കിയ കരുത്തുറ്റ പരമ്പരാഗത ധാന്യ മിശ്രിതം.',
   60000, 'assets/ans-kodo-pro.jpg', 'kodo', 3, 100, TRUE)
) AS v(id, name_en, name_ml, grain_en, grain_ml, short_en, short_ml, copy_en, copy_ml,
       price_paise, image, type, featured, stock, active)
WHERE NOT EXISTS (SELECT 1 FROM products);
