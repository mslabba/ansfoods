-- Per-product "Millet wellness benefits", editable in the admin panel and
-- rendered on the product page. Shape: JSONB array of
-- { titleEn, titleMl, textEn, textMl } (same EN/ML field convention as the
-- rest of the product row). An empty array hides the section on the page.
ALTER TABLE products ADD COLUMN IF NOT EXISTS benefits JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Seed existing products with the six benefit items previously hard-coded
-- in the storefront detail overlay, so nothing changes until an admin edits
-- them. Only touches rows that have no benefits saved yet.
UPDATE products SET benefits = $benefits$[{"titleEn": "Fibre for digestion", "titleMl": "ദഹനത്തിന് നാരുകൾ", "textEn": "Supports digestion and regularity.", "textMl": "ദഹനം മെച്ചപ്പെടുത്താനും മലബന്ധം ഒഴിവാക്കാനും സഹായിക്കുന്നു."}, {"titleEn": "Balanced everyday eating", "titleMl": "ശരീരഭാരം നിയന്ത്രിക്കാൻ", "textEn": "A satisfying grain choice for healthy weight goals.", "textMl": "തൃപ്തി നൽകുന്ന ധാന്യമായതിനാൽ ശരീരഭാരം നിയന്ത്രിക്കുന്ന ഭക്ഷണക്രമത്തെ പിന്തുണയ്ക്കുന്നു."}, {"titleEn": "Nutrients and antioxidants", "titleMl": "പോഷകങ്ങളും ആന്റിഓക്സിഡന്റുകളും", "textEn": "Contributes to everyday immune wellbeing.", "textMl": "ശരീരത്തിന്റെ സ്വാഭാവിക പ്രതിരോധശേഷിയെ പിന്തുണയ്ക്കുന്നു."}, {"titleEn": "Heart-friendly nutrients", "titleMl": "ഹൃദയാരോഗ്യത്തിന് പിന്തുണ", "textEn": "Fibre, magnesium and potassium support a heart-conscious diet.", "textMl": "നാരുകൾ, മഗ്നീഷ്യം, പൊട്ടാസ്യം എന്നിവ ഹൃദയാരോഗ്യം ശ്രദ്ധിക്കുന്ന ഭക്ഷണക്രമത്തിന് അനുയോജ്യമാണ്."}, {"titleEn": "Steadier energy", "titleMl": "പഞ്ചസാര നിയന്ത്രണത്തിന് പിന്തുണ", "textEn": "Whole millets can support a steadier blood-sugar response than refined grains.", "textMl": "കൂടുതൽ സംസ്കരിച്ച ധാന്യങ്ങളെ അപേക്ഷിച്ച് രക്തത്തിലെ പഞ്ചസാര പെട്ടെന്ന് ഉയരാതിരിക്കാൻ സഹായിക്കാം."}, {"titleEn": "Naturally gluten-free", "titleMl": "സ്വാഭാവികമായി ഗ്ലൂട്ടൻ രഹിതം", "textEn": "Millet itself is a naturally gluten-free grain.", "textMl": "മില്ലറ്റ് സ്വാഭാവികമായി ഗ്ലൂട്ടൻ രഹിതമായ ധാന്യമാണ്."}]$benefits$::jsonb
WHERE benefits = '[]'::jsonb;
