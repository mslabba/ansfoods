'use strict';
// Server-side product catalog. Prices are the source of truth —
// the checkout API recomputes every order total from here and
// never trusts amounts sent by the browser. Amounts in paise.
module.exports = {
  barnyard: { pricePaise: 60000, nameEn: 'Barnyard Millet Kanji Mix', nameMl: 'കുതിരവാലി മില്ലറ്റ് കഞ്ഞി മിക്സ്' },
  little:   { pricePaise: 60000, nameEn: 'Little Millet Kanji Mix',   nameMl: 'ചാമ മില്ലറ്റ് കഞ്ഞി മിക്സ്' },
  kodo:     { pricePaise: 60000, nameEn: 'Kodo Millet Kanji Mix',      nameMl: 'വരക് മില്ലറ്റ് കഞ്ഞി മിക്സ്' },
};
