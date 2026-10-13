/* ANS Foods shared store: product catalog, cart (localStorage) and language.
   Loaded by index.html and shop.html so the cart and language choice
   follow the shopper across pages. No dependencies. */
(function () {
  'use strict';

  var CART_KEY = 'ans_cart_v1';
  var LANG_KEY = 'ans_lang';

  var PRODUCTS = {
    barnyard: {
      id: 'barnyard',
      type: 'barnyard',
      en: 'Barnyard Millet Kanji Mix', ml: 'കുതിരവാലി മില്ലറ്റ് കഞ്ഞി മിക്സ്',
      grainEn: 'Barnyard millet', grainMl: 'കുതിരവാലി',
      copyEn: 'A naturally hearty grain blend with a light, comforting finish—made for a warm and wholesome everyday bowl.',
      copyMl: 'ലളിതവും ഹൃദ്യവുമായ രുചിയോടെ, ദിവസവും ഒരു ഊഷ്മളവും പോഷകസമൃദ്ധവുമായ കഞ്ഞി തയ്യാറാക്കാൻ അനുയോജ്യമായ നാടൻ ധാന്യ മിശ്രിതം.',
      img: 'assets/ans-barnyard-pro.jpg', price: 600, featured: 1
    },
    little: {
      id: 'little',
      type: 'little',
      en: 'Little Millet Kanji Mix', ml: 'ചാമ മില്ലറ്റ് കഞ്ഞി മിക്സ്',
      grainEn: 'Little millet', grainMl: 'ചാമ',
      copyEn: 'A gentle everyday millet blend with a familiar, satisfying texture—an uncomplicated choice for your breakfast table.',
      copyMl: 'പരിചിതമായ രുചിയും സംതൃപ്തമായ ഘടനയുമുള്ള ദൈനംദിന മില്ലറ്റ് മിശ്രിതം—പ്രഭാതഭക്ഷണത്തിന് ലളിതമായൊരു തിരഞ്ഞെടുപ്പ്.',
      img: 'assets/ans-little-pro.jpg', price: 600, featured: 2
    },
    kodo: {
      id: 'kodo',
      type: 'kodo',
      en: 'Kodo Millet Kanji Mix', ml: 'വരക് മില്ലറ്റ് കഞ്ഞി മിക്സ്',
      grainEn: 'Kodo millet', grainMl: 'വരക്',
      copyEn: 'A robust traditional grain blend for a warm, wholesome bowl with a satisfying, homestyle character.',
      copyMl: 'ഊഷ്മളവും പോഷകസമൃദ്ധവുമായ കഞ്ഞിക്കായി, നാടൻ രുചിയോടെ തയ്യാറാക്കിയ കരുത്തുറ്റ പരമ്പരാഗത ധാന്യ മിശ്രിതം.',
      img: 'assets/ans-kodo-pro.jpg', price: 600, featured: 3
    }
  };

  function readJSON(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeJSON(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function getLang() {
    var l = readJSON(LANG_KEY, 'en');
    return l === 'ml' ? 'ml' : 'en';
  }
  function applyLang() {
    var l = getLang();
    document.body.classList.toggle('ml', l === 'ml');
    document.documentElement.lang = l === 'ml' ? 'ml' : 'en';
    document.querySelectorAll('.lang-btn').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === l));
    });
    return l;
  }
  function setLang(l) {
    writeJSON(LANG_KEY, l === 'ml' ? 'ml' : 'en');
    return applyLang();
  }

  function loadCart() {
    var c = readJSON(CART_KEY, {});
    var clean = {};
    Object.keys(c).forEach(function (id) {
      var q = Number(c[id]);
      if (PRODUCTS[id] && q > 0) clean[id] = Math.min(99, Math.floor(q));
    });
    return clean;
  }
  function saveCart(cart) { writeJSON(CART_KEY, cart || {}); }

  function cartCount(cart) {
    return Object.keys(cart).reduce(function (s, id) { return s + (cart[id] || 0); }, 0);
  }
  function cartTotal(cart) {
    return Object.keys(cart).reduce(function (s, id) {
      return s + (PRODUCTS[id] ? PRODUCTS[id].price * cart[id] : 0);
    }, 0);
  }

  function money(n) { return '₹' + Number(n).toLocaleString('en-IN'); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  window.ANS = {
    PRODUCTS: PRODUCTS,
    getLang: getLang,
    setLang: setLang,
    applyLang: applyLang,
    cart: { load: loadCart, save: saveCart, count: cartCount, total: cartTotal },
    money: money,
    esc: esc
  };
})();
