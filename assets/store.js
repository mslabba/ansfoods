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
      shortEn: 'A naturally hearty grain blend with a light, comforting finish.',
      shortMl: 'ലളിതവും ഹൃദ്യവുമായ രുചിയുള്ള നാടൻ ധാന്യ മിശ്രിതം.',
      copyEn: 'A naturally hearty grain blend with a light, comforting finish—made for a warm and wholesome everyday bowl.',
      copyMl: 'ലളിതവും ഹൃദ്യവുമായ രുചിയോടെ, ദിവസവും ഒരു ഊഷ്മളവും പോഷകസമൃദ്ധവുമായ കഞ്ഞി തയ്യാറാക്കാൻ അനുയോജ്യമായ നാടൻ ധാന്യ മിശ്രിതം.',
      img: 'assets/ans-barnyard-pro.jpg', price: 600, featured: 1, stock: 100
    },
    little: {
      id: 'little',
      type: 'little',
      en: 'Little Millet Kanji Mix', ml: 'ചാമ മില്ലറ്റ് കഞ്ഞി മിക്സ്',
      grainEn: 'Little millet', grainMl: 'ചാമ',
      shortEn: 'A gentle everyday millet blend with a familiar, satisfying texture.',
      shortMl: 'പരിചിതമായ രുചിയും സംതൃപ്തമായ ഘടനയുമുള്ള ദൈനംദിന മില്ലറ്റ് മിശ്രിതം.',
      copyEn: 'A gentle everyday millet blend with a familiar, satisfying texture—an uncomplicated choice for your breakfast table.',
      copyMl: 'പരിചിതമായ രുചിയും സംതൃപ്തമായ ഘടനയുമുള്ള ദൈനംദിന മില്ലറ്റ് മിശ്രിതം—പ്രഭാതഭക്ഷണത്തിന് ലളിതമായൊരു തിരഞ്ഞെടുപ്പ്.',
      img: 'assets/ans-little-pro.jpg', price: 600, featured: 2, stock: 100
    },
    kodo: {
      id: 'kodo',
      type: 'kodo',
      en: 'Kodo Millet Kanji Mix', ml: 'വരക് മില്ലറ്റ് കഞ്ഞി മിക്സ്',
      grainEn: 'Kodo millet', grainMl: 'വരക്',
      shortEn: 'A robust traditional grain blend for a warm, wholesome bowl.',
      shortMl: 'ഊഷ്മളവും പോഷകസമൃദ്ധവുമായ കഞ്ഞിക്കായി നാടൻ ധാന്യ മിശ്രിതം.',
      copyEn: 'A robust traditional grain blend for a warm, wholesome bowl with a satisfying, homestyle character.',
      copyMl: 'ഊഷ്മളവും പോഷകസമൃദ്ധവുമായ കഞ്ഞിക്കായി, നാടൻ രുചിയോടെ തയ്യാറാക്കിയ കരുത്തുറ്റ പരമ്പരാഗത ധാന്യ മിശ്രിതം.',
      img: 'assets/ans-kodo-pro.jpg', price: 600, featured: 3, stock: 100
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
  function clearCart() {
    try { window.localStorage.removeItem(CART_KEY); } catch (e) {}
    try { window.sessionStorage.removeItem(CART_KEY); } catch (e) {}
  }
  // Keep a page's in-memory cart in sync when another tab changes it
  // (e.g. the order-status tab clears it after a successful payment).
  function onCartChange(cb) {
    window.addEventListener('storage', function (e) {
      if (e.key === CART_KEY || e.key === null) cb(loadCart());
    });
  }

  /* ---------- shared cart UI: badge, floating button, "added" toast ---------- */
  function syncCartBadge(count) {
    document.querySelectorAll('.cart-count').forEach(function (el) { el.textContent = count; });
    var fab = document.querySelector('.cart-fab');
    if (fab) fab.classList.toggle('has-items', count > 0);
  }
  function bump(el) {
    if (!el) return;
    el.classList.remove('cart-bump');
    void el.offsetWidth; // restart the animation
    el.classList.add('cart-bump');
    window.setTimeout(function () { el.classList.remove('cart-bump'); }, 700);
  }
  // Toast with a "View cart" action. Never navigates on its own.
  function notifyAdded(lang, onView) {
    var toast = document.querySelector('.toast');
    var ml = lang === 'ml';
    if (toast) {
      toast.innerHTML = '<span>' + (ml ? 'കാർട്ടിൽ ചേർത്തു' : 'Added to cart') + '</span>' +
        '<button type="button" class="toast-action">' + (ml ? 'കാർട്ട് കാണുക' : 'View cart') + '</button>';
      toast.classList.add('show', 'has-action');
      toast.querySelector('.toast-action').addEventListener('click', function () {
        toast.classList.remove('show', 'has-action');
        if (onView) onView();
      });
      window.clearTimeout(notifyAdded.timer);
      notifyAdded.timer = window.setTimeout(function () { toast.classList.remove('show', 'has-action'); }, 3500);
    }
    bump(document.querySelector('.cart-trigger'));
    bump(document.querySelector('.cart-fab'));
  }

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

  // Pull the live catalog from the server. Mutates PRODUCTS in place so
  // existing references stay valid. Falls back to the built-in list when
  // the API is unreachable. Resolves true when fresh data was applied.
  function refreshProducts() {
    return window.fetch('/api/products', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !Array.isArray(j.products) || !j.products.length) return false;
        var fresh = {};
        j.products.forEach(function (p) {
          fresh[p.id] = {
            id: p.id, type: p.type || p.id,
            en: p.nameEn, ml: p.nameMl || p.nameEn,
            grainEn: p.grainEn || '', grainMl: p.grainMl || '',
            shortEn: p.shortEn || '', shortMl: p.shortMl || '',
            copyEn: p.copyEn || '', copyMl: p.copyMl || '',
            img: p.image || '', price: p.pricePaise / 100,
            featured: p.featured || 0, stock: p.stock == null ? 0 : p.stock
          };
        });
        Object.keys(PRODUCTS).forEach(function (k) { delete PRODUCTS[k]; });
        Object.keys(fresh).forEach(function (k) { PRODUCTS[k] = fresh[k]; });
        return true;
      })
      .catch(function () { return false; });
  }

  function productName(p, lang) { return lang === 'ml' ? (p.ml || p.en) : p.en; }

  // One canonical product card used by the home page and the shop page.
  function productCardHTML(p, lang) {
    var ml = lang === 'ml';
    var name = productName(p, lang);
    var grain = ml ? (p.grainMl || p.grainEn) : p.grainEn;
    var short = ml ? (p.shortMl || p.shortEn) : p.shortEn;
    var out = p.stock <= 0;
    var low = !out && p.stock <= 5;
    var btn = out
      ? '<button class="add-btn" type="button" disabled>' + (ml ? 'സ്റ്റോക്കില്ല' : 'Out of stock') + '</button>'
      : '<button class="add-btn" type="button" data-product="' + esc(p.id) + '">' + (ml ? 'കാർട്ടിൽ ചേർക്കുക' : 'Add to cart') + '</button>';
    return '<article class="product-card">' +
      '<button class="product-image-link" type="button" data-details="' + esc(p.id) + '" aria-label="' + esc((ml ? 'കാണൂ ' : 'View ') + name) + '">' +
      '<span class="product-image"><img src="' + esc(p.img) + '" alt="ANS Foods ' + esc(name) + '" loading="lazy" /></span></button>' +
      '<div class="product-body">' +
      '<p class="product-kicker">' + esc(grain) + '</p>' +
      '<h3 class="product-title"><button class="product-title-link" type="button" data-details="' + esc(p.id) + '">' + esc(name) + '</button></h3>' +
      (short ? '<p class="product-copy">' + esc(short) + '</p>' : '') +
      '<div class="product-bottom"><div class="price"><strong>' + money(p.price) + '</strong><span>900 g</span></div>' +
      '<div class="product-actions">' + btn + '</div></div>' +
      (low ? '<p class="stock-note">' + esc(ml ? 'അവശേഷിക്കുന്നത് ' + p.stock + ' എണ്ണം' : 'Only ' + p.stock + ' left') + '</p>' : '') +
      '</div></article>';
  }

  window.ANS = {
    PRODUCTS: PRODUCTS,
    getLang: getLang,
    setLang: setLang,
    applyLang: applyLang,
    refreshProducts: refreshProducts,
    productName: productName,
    productCardHTML: productCardHTML,
    cart: { load: loadCart, save: saveCart, clear: clearCart, onChange: onCartChange, count: cartCount, total: cartTotal },
    ui: { syncCartBadge: syncCartBadge, notifyAdded: notifyAdded },
    money: money,
    esc: esc
  };
})();
