
  // Keep icon rendering cheap on mobile by coalescing repeated DOM scans.
  let __iconsQueued = false;
  function refreshIcons(){
    if(!window.lucide || __iconsQueued) return;
    __iconsQueued = true;
    const run = () => {
      __iconsQueued = false;
      try{ window.lucide.createIcons(); }catch(err){ /* icon library unavailable */ }
    };
    if(window.requestAnimationFrame) requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  // ============================================================
  // CURRENCY MODULE
  // Lets shoppers switch the whole storefront between USD and PKR
  // (Pakistani Rupees). Prices are authored/stored in USD everywhere
  // (admin form, orders, analytics); formatPrice() converts + formats
  // for display only, using a fixed demo exchange rate.
  // ============================================================
  const CURRENCY_KEY = 'genz_currency';
  // Fixed demo rate — for a real store, pull a live FX rate instead.
  const CURRENCY_RATES = { USD: 1, PKR: 280 };
  const CURRENCY_SYMBOLS = { USD: '$', PKR: 'Rs ' };
  function getCurrency(){
    try{ return localStorage.getItem(CURRENCY_KEY) || 'USD'; }catch(err){ return 'USD'; }
  }
  function setCurrencyPref(code){
    try{ localStorage.setItem(CURRENCY_KEY, code); }catch(err){ /* storage unavailable */ }
  }
  // forceDecimals: pass true for money totals that should always show
  // cents in USD (e.g. discounted totals); PKR always rounds to whole Rupees.
  function formatPrice(usdAmount, forceDecimals){
    const code = getCurrency();
    const rate = CURRENCY_RATES[code] || 1;
    const amount = (Number(usdAmount) || 0) * rate;
    const symbol = CURRENCY_SYMBOLS[code] || '$';
    if(code === 'PKR'){
      return symbol + Math.round(amount).toLocaleString('en-US');
    }
    if(forceDecimals) return symbol + amount.toFixed(2);
    return symbol + (Number.isInteger(amount) ? amount : Math.round(amount * 100) / 100);
  }
  // Re-renders every part of the UI that shows a price, called right
  // after the currency dropdown changes.
  function refreshAllPriceDisplays(){
    try{ if(window.__products) window.__products.render(); }catch(err){ /* products module not ready */ }
    try{ if(typeof renderCart === 'function') renderCart(); }catch(err){ /* cart module not ready */ }
    try{ if(typeof renderWishlist === 'function') renderWishlist(); }catch(err){ /* wishlist module not ready */ }
  }
  const currSelectEl = document.getElementById('currSelect');
  if(currSelectEl){
    currSelectEl.value = getCurrency();
    currSelectEl.addEventListener('change', () => {
      setCurrencyPref(currSelectEl.value);
      refreshAllPriceDisplays();
    });
  }

  function showScreen(name){
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + name).classList.add('active');
    window.scrollTo(0,0);
  }

  // ============================================================
  // PASSWORD HASHING (SECURITY)
  // Passwords are never stored or displayed in plain text anymore.
  // Uses the browser's built-in Web Crypto SHA-256; falls back to a
  // simple non-cryptographic hash only if SubtleCrypto is unavailable
  // (very old browsers / non-secure context), so the app still works.
  // IMPORTANT: this is still a client-side-only demo — real projects
  // must hash + verify passwords on a server, never in the browser.
  // ============================================================
  async function hashPassword(plain){
    const text = String(plain || '');
    try{
      if(window.crypto && window.crypto.subtle){
        const data = new TextEncoder().encode(text);
        const digest = await window.crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('');
      }
    }catch(err){ console.warn('SubtleCrypto unavailable, using fallback hash', err); }
    // Fallback: simple FNV-1a hash — NOT cryptographically secure, only
    // used so the demo keeps working in environments without SubtleCrypto.
    let hash = 0x811c9dc5;
    for(let i = 0; i < text.length; i++){
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return 'fnv1a_' + (hash >>> 0).toString(16);
  }

  // ---------- Session: remembers who's signed in across visits ----------
  const CURRENT_USER_KEY = 'genz_current_user';
  function getCurrentUser(){
    try{
      const raw = localStorage.getItem(CURRENT_USER_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(err){ return null; }
  }
  function setCurrentUser(user){
    try{ localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user)); }
    catch(err){ console.warn('Could not save session', err); }
  }
  function clearCurrentUser(){
    try{ localStorage.removeItem(CURRENT_USER_KEY); }
    catch(err){ console.warn('Could not clear session', err); }
  }
  function updateLoginButtonUI(){
    const loginBtn = document.getElementById('loginBtn');
    if(!loginBtn) return;
    const user = getCurrentUser();
    const label = loginBtn.querySelector('.login-label');
    if(user){
      loginBtn.classList.add('logged-in');
      if(label) label.textContent = 'Logout';
      loginBtn.setAttribute('title', `Logout (${user.name})`);
      loginBtn.setAttribute('aria-label', `Log out of ${user.name}'s account`);
    } else {
      loginBtn.classList.remove('logged-in');
      if(label) label.textContent = 'Login';
      loginBtn.setAttribute('title', 'Login');
      loginBtn.setAttribute('aria-label', 'Open login');
    }
  }
  updateLoginButtonUI();

  setTimeout(() => {
    // Returning, already-signed-in visitors skip straight past Welcome/Login.
    showScreen(getCurrentUser() ? 'main' : 'login');
  }, 5000);

  document.getElementById('enterSiteBtn').addEventListener('click', () => showScreen('login'));
  document.getElementById('backToWelcome').addEventListener('click', () => showScreen('welcome'));

  const guestBrowseBtn = document.getElementById('guestBrowseBtn');
  if(guestBrowseBtn){
    guestBrowseBtn.addEventListener('click', () => {
      try{ playSound('click'); }catch(err){ /* sound module unavailable */ }
      showScreen('main');
    });
  }

  // Declared here (outside the try blocks below) so every try block — including
  // the payment handler further down — can read and update the same cart/wishlist.
  let cart = [];
  let wishlist = [];
  // Whether the currently signed-in user is an admin. Toggled by the admin
  // login handler further down. Controls visibility of Edit/Archive buttons
  // on product cards and the Admin Control Panel button in the nav.
  let isAdmin = false;

  // ============================================================
  // DISCOUNT / PROMO CODES
  // Editable from the Admin Panel → Discounts tab. Stored in
  // localStorage (seeded with 3 starter codes the first time), same
  // save-the-whole-array pattern used by the products module above.
  // `appliedDiscount` holds the currently-active code (or null) and
  // is read by renderCart().
  // ============================================================
  const DISCOUNTS_KEY = 'genz_discount_codes_v1';
  const DEFAULT_DISCOUNTS = [
    { code: 'GENZ10',    type: 'percent', value: 10, label: '10% off your order' },
    { code: 'WELCOME15', type: 'percent', value: 15, label: '15% off — welcome to GEN_Z' },
    { code: 'DROP5',     type: 'flat',    value: 5,  label: '$5 off your order' }
  ];
  function loadDiscounts(){
    try{
      const raw = localStorage.getItem(DISCOUNTS_KEY);
      if(raw){ const parsed = JSON.parse(raw); if(Array.isArray(parsed)) return parsed; }
    }catch(err){ console.warn('Could not read saved discount codes, using defaults.', err); }
    return DEFAULT_DISCOUNTS.map(d => ({...d}));
  }
  function saveDiscounts(){
    try{ localStorage.setItem(DISCOUNTS_KEY, JSON.stringify(discountCodes)); }
    catch(err){ console.warn('Could not save discount codes', err); }
  }
  let discountCodes = loadDiscounts();
  let appliedDiscount = null; // { code, type, value, label } | null

  // ============================================================
  // ORDER STORAGE & TRACKING
  // Declared here (outside the try blocks) so both the payment
  // handler and the Track Order modal further down can read/write
  // the same order list. Orders are saved locally (no real backend)
  // keyed by the email the buyer used at checkout, and a simulated
  // "stage" is computed from how long ago the order was placed —
  // this stands in for a real courier/shipping status feed.
  // ============================================================
  const ORDERS_KEY = 'genz_orders_v1';
  // How many hours after placing an order before it moves to the next
  // stage. Tweak these if you plug in a real fulfillment/courier system.
  const ORDER_STAGE_HOURS = { packed: 1, shipped: 24, outForDelivery: 72, delivered: 120 };
  const ORDER_STEPS = [
    { key: 'placed', label: 'Order Placed', icon: 'clipboard-check' },
    { key: 'packed', label: 'Packed', icon: 'package' },
    { key: 'shipped', label: 'Shipped', icon: 'truck' },
    { key: 'outForDelivery', label: 'Out for Delivery', icon: 'map-pin' },
    { key: 'delivered', label: 'Delivered', icon: 'circle-check' }
  ];

  function loadOrders(){
    try{
      const raw = localStorage.getItem(ORDERS_KEY);
      if(raw){ const parsed = JSON.parse(raw); if(Array.isArray(parsed)) return parsed; }
    }catch(err){ console.warn('Could not read saved orders', err); }
    return [];
  }
  function saveOrders(list){
    try{ localStorage.setItem(ORDERS_KEY, JSON.stringify(list)); }
    catch(err){ console.warn('Could not save orders', err); }
  }
  // Turns elapsed time since the order was placed into a current-stage
  // index (0 = Order Placed ... 4 = Delivered).
  function getOrderStageIndex(order){
    const hoursSince = (Date.now() - new Date(order.date).getTime()) / 36e5;
    if(hoursSince >= ORDER_STAGE_HOURS.delivered) return 4;
    if(hoursSince >= ORDER_STAGE_HOURS.outForDelivery) return 3;
    if(hoursSince >= ORDER_STAGE_HOURS.shipped) return 2;
    if(hoursSince >= ORDER_STAGE_HOURS.packed) return 1;
    return 0;
  }

  refreshIcons();

  // ============================================================
  // IMAGE UPLOAD HELPERS
  // Shared by every "Picture" field (Products, Offerings, Crew,
  // Ads). Lets the admin either paste an image URL OR pick a file
  // straight from their computer — picked files are shrunk down
  // with a canvas and stored as a data URL (so everything still
  // saves into localStorage like the URL-based images do).
  // ============================================================
  function fileToResizedDataUrl(file, maxDim){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width, height = img.height;
          const dim = maxDim || 1000;
          if(width > dim || height > dim){
            const scale = Math.min(dim / width, dim / height);
            width = Math.round(width * scale);
            height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => reject(new Error('Could not read that image'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Could not read that file'));
      reader.readAsDataURL(file);
    });
  }

  function updateImagePreview(textId, previewId){
    const textInput = document.getElementById(textId);
    const preview = document.getElementById(previewId);
    if(!textInput || !preview) return;
    const val = textInput.value.trim();
    preview.style.backgroundImage = val ? `url('${val}')` : '';
    preview.classList.toggle('has-image', !!val);
  }

  // Wires a "Picture" field's URL text input + hidden file input +
  // preview box together. Safe to call every time the field's HTML
  // is (re)injected, e.g. each time the Quick Edit modal opens.
  function wireImageField(textId, fileId, previewId){
    const textInput = document.getElementById(textId);
    const fileInput = document.getElementById(fileId);
    if(!textInput || !fileInput) return;
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      if(!file) return;
      if(!file.type.startsWith('image/')){
        alert('Please choose an image file.');
        fileInput.value = '';
        return;
      }
      try{
        const dataUrl = await fileToResizedDataUrl(file, 1000);
        textInput.value = dataUrl;
        updateImagePreview(textId, previewId);
      }catch(err){
        console.warn('Image upload failed', err);
        alert('Could not read that image — try a different file.');
      }
      fileInput.value = '';
    });
    textInput.addEventListener('input', () => updateImagePreview(textId, previewId));
    updateImagePreview(textId, previewId);
  }

  // ============================================================
  // PRODUCTS MODULE
  // Product catalog lives in a plain JS array. Any admin add/edit/
  // delete updates this array AND persists it to localStorage so
  // changes survive a page refresh. The storefront grid re-renders
  // from this array any time it changes.
  // ============================================================
  try{

  const PRODUCTS_KEY = 'genz_products_v2';

  const DEFAULT_PRODUCTS = [
    { id:'p1', name:'Signature Noir Perfume', price:75, category:'Fragrance', tag:'NEW DROP', stock:30, rating:4.8, reviews:126, image:'https://images.unsplash.com/photo-1587017539504-67cfbddac569?w=600&h=750&fit=crop' },
    { id:'p2', name:'Classic Slim Jeans', price:68, category:'Bottoms', tag:'', stock:40, rating:4.6, reviews:214, sizes:['28','30','32','34','36'], image:'https://images.unsplash.com/photo-1584370848010-d7fe6bc767ec?w=600&h=750&fit=crop' },
    { id:'p3', name:'Baggy Cargo Jeans', price:89, category:'Bottoms', tag:'LIMITED', stock:12, rating:4.9, reviews:58, sizes:['30','32','34','36'], image:'https://images.unsplash.com/photo-1490578474895-699cd4e2cf59?w=600&h=750&fit=crop' },
    { id:'p4', name:'Oversized Graphic Tee', price:42, category:'Tops', tag:'NEW DROP', stock:55, rating:4.7, reviews:301, sizes:['S','M','L','XL'], image:'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=600&h=750&fit=crop' },
    { id:'p5', name:'Street Chain Necklace', price:28, category:'Accessories', tag:'', stock:35, rating:4.5, reviews:89, image:'https://images.unsplash.com/photo-1552346154-21d32810aba3?w=600&h=750&fit=crop' },
    { id:'p6', name:'Bucket Hat', price:32, category:'Accessories', tag:'', stock:38, rating:4.4, reviews:112, image:'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=600&h=750&fit=crop' },
    { id:'p7', name:'Aviator Sunglasses', price:55, category:'Accessories', tag:'', stock:22, rating:4.7, reviews:73, image:'https://images.unsplash.com/photo-1560243563-062bfc001d68?w=600&h=750&fit=crop' },
    { id:'p8', name:'Leather Strap Wallet', price:45, category:'Accessories', tag:'RESTOCKED', stock:18, rating:4.8, reviews:95, image:'https://images.unsplash.com/photo-1550246140-29f40b909e5a?w=600&h=750&fit=crop' }
  ];

  function loadProducts(){
    try{
      const raw = localStorage.getItem(PRODUCTS_KEY);
      if(raw){
        const parsed = JSON.parse(raw);
        if(Array.isArray(parsed) && parsed.length) return parsed;
      }
    }catch(err){ console.warn('Could not read saved products, using defaults.', err); }
    return DEFAULT_PRODUCTS.map(p => ({...p}));
  }

  function saveProducts(){
    try{ localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products)); }
    catch(err){ console.warn('Could not save products to localStorage', err); }
  }

  // Global-ish product catalog (function-scoped to this try block, but every
  // other block in this script — same pattern already used for cart/wishlist
  // helpers — can reach it because plain <script> tags hoist `function`
  // declarations from inner blocks up to the top level).
  let products = loadProducts();

  function escapeHtml(str){
    return String(str === null || str === undefined ? '' : str).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // Renders a 5-star row as inline SVG stars (full/half/empty) for a given
  // numeric rating, so product cards can show ratings without extra image
  // assets or waiting on the Lucide icon script to run.
  function renderStars(rating){
    const r = Math.max(0, Math.min(5, Number(rating) || 0));
    let html = '';
    for(let i = 1; i <= 5; i++){
      const fillPct = Math.max(0, Math.min(1, r - (i - 1))) * 100;
      html += `<span class="star" style="--fill:${fillPct}%">★</span>`;
    }
    return `<span class="star-row">${html}</span>`;
  }

  function renderProducts(){
    const grid = document.getElementById('productGrid');
    if(!grid) return;
    const cardsHtml = products.map(p => {
      const wishlisted = wishlist.some(w => w.name === p.name);
      const soldOut = Number(p.stock) <= 0;
      const lowStock = !soldOut && Number(p.stock) <= 5;
      const img = p.image && p.image.trim() ? p.image : 'https://images.unsplash.com/photo-1541643600914-78b084683601?w=600&h=750&fit=crop';
      return `
      <div class="product-card" data-category="${escapeHtml(p.category)}" data-id="${escapeHtml(p.id)}">
        <div class="product-photo">
          <img src="${escapeHtml(img)}" alt="${escapeHtml(p.name)}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1541643600914-78b084683601?w=600&h=750&fit=crop';">
          <span class="stock-badge ${lowStock || soldOut ? 'low' : ''}">${soldOut ? 'Sold Out' : p.stock + ' In Stock'}</span>
          <button class="wishlist-btn${wishlisted ? ' active' : ''}" data-name="${escapeHtml(p.name)}" data-price="${p.price}" aria-label="Save ${escapeHtml(p.name)} to wishlist"><i data-lucide="heart"></i></button>
        </div>
        <div class="product-body">
          <p class="product-tag"${p.tag ? ' style="color:var(--accent-warm);font-weight:700;"' : ''}>${p.tag ? escapeHtml(p.tag) : escapeHtml(p.category)}</p>
          <h3 class="product-name">${escapeHtml(p.name)}</h3>
          <div class="product-rating">${renderStars(p.rating || 0)}<span class="rating-count">${(p.rating || 0).toFixed(1)} (${p.reviews || 0})</span></div>
          ${Array.isArray(p.sizes) && p.sizes.length ? `
          <div class="size-chip-row" data-size-group="${escapeHtml(p.id)}">
            ${p.sizes.map((s, i) => `<button type="button" class="size-chip${i === 0 ? ' active' : ''}" data-size="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}
          </div>` : ''}
          <div class="product-row">
            <span class="product-price">${formatPrice(p.price)}</span>
            <div class="product-btn-group">
              <button class="add-cart-btn" data-name="${escapeHtml(p.name)}" data-price="${p.price}" ${soldOut ? 'disabled' : ''}>${soldOut ? 'Sold Out' : 'Add to Cart'}</button>
              <button class="order-now-btn" data-name="${escapeHtml(p.name)}" data-price="${p.price}" ${soldOut ? 'disabled' : ''} aria-label="Buy ${escapeHtml(p.name)} now"><i data-lucide="zap"></i>Buy Now</button>
            </div>
          </div>
          <div class="product-links-row">
            <button type="button" class="size-guide-link" data-open-size-guide>Size Guide</button>
            <button type="button" class="rate-review-link" data-open-review data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}"><i data-lucide="star" style="width:12px;height:12px;"></i>Rate &amp; Review</button>
          </div>
        </div>
        <div class="product-admin-row">
          <button type="button" class="admin-mini-btn edit" data-id="${escapeHtml(p.id)}"><i data-lucide="pencil"></i>Edit</button>
          <button type="button" class="admin-mini-btn delete" data-id="${escapeHtml(p.id)}"><i data-lucide="archive"></i>Archive</button>
        </div>
      </div>`;
    }).join('');
    grid.innerHTML = cardsHtml + '<p class="shop-empty" id="shopEmptyState">No pieces match your search. Try a different word or filter.</p>';
    refreshIcons();
    // Re-apply the 3D tilt effect to the freshly rendered cards, and re-apply
    // any active search/category filter so the grid stays consistent.
    try{ if(typeof initTilt === 'function') initTilt('.product-card', { maxTilt: 7, glareTarget: '.product-photo' }); }catch(err){ /* tilt module not ready yet */ }
    try{ if(typeof applyShopFilters === 'function') applyShopFilters(); }catch(err){ /* filter module not ready yet */ }
  }

  // Delegated click handling for all product-card buttons. Because cards are
  // rebuilt on every render, a single listener on the grid container (rather
  // than one per card) keeps working no matter how many times admin actions
  // change the catalog.
  const productGridEl = document.getElementById('productGrid');
  if(productGridEl){
    productGridEl.addEventListener('click', (e) => {
      const sizeChipBtn = e.target.closest('.size-chip');
      const addBtn = e.target.closest('.add-cart-btn');
      const orderBtn = e.target.closest('.order-now-btn');
      const wishBtn = e.target.closest('.wishlist-btn');
      const editBtn = e.target.closest('.admin-mini-btn.edit');
      const delBtn = e.target.closest('.admin-mini-btn.delete');
      const sizeBtn = e.target.closest('[data-open-size-guide]');
      const reviewBtn = e.target.closest('[data-open-review]');
      if(sizeChipBtn){
        (function(){ var _row = sizeChipBtn.closest('.size-chip-row'); if(_row) _row.querySelectorAll('.size-chip').forEach(function(c){ c.classList.remove('active'); }); })();
        sizeChipBtn.classList.add('active');
      } else if(addBtn && !addBtn.disabled && typeof window.addToCart === 'function'){
        const _addCard = addBtn.closest('.product-card');
        const activeChip = _addCard ? _addCard.querySelector('.size-chip.active') : null;
        const cartName = activeChip ? `${addBtn.dataset.name} (Size ${activeChip.dataset.size})` : addBtn.dataset.name;
        window.addToCart(cartName, addBtn.dataset.price, addBtn);
      } else if(orderBtn && !orderBtn.disabled && typeof window.orderNow === 'function'){
        const _orderCard = orderBtn.closest('.product-card');
        const activeChip = _orderCard ? _orderCard.querySelector('.size-chip.active') : null;
        const cartName = activeChip ? `${orderBtn.dataset.name} (Size ${activeChip.dataset.size})` : orderBtn.dataset.name;
        window.orderNow(cartName, orderBtn.dataset.price);
      } else if(wishBtn && typeof window.toggleWishlist === 'function'){
        window.toggleWishlist(wishBtn.dataset.name, Number(wishBtn.dataset.price), wishBtn);
      } else if(editBtn && isAdmin && typeof window.openAdminEditForm === 'function'){
        window.openAdminEditForm(editBtn.dataset.id);
      } else if(delBtn && isAdmin && typeof window.deleteProduct === 'function'){
        window.deleteProduct(delBtn.dataset.id);
      } else if(sizeBtn && typeof window.openModal === 'function'){
        window.openModal('sizeGuideOverlay');
      } else if(reviewBtn && typeof window.openReviewModal === 'function'){
        window.openReviewModal(reviewBtn.dataset.id, reviewBtn.dataset.name);
      }
    });
  }

  // Expose for the Admin Control Panel module below.
  window.__products = {
    get: () => products,
    set: (next) => { products = next; saveProducts(); },
    save: saveProducts,
    render: renderProducts
  };

  }catch(err){ console.warn('Products module setup failed', err); }

  // ============================================================
  // PRODUCT REVIEWS MODULE
  // Per-product reviews (name + star rating + comment), separate from
  // the site-wide testimonials in the static Reviews section. Stored
  // in localStorage keyed by product id. Submitting a review recomputes
  // that product's average `rating` and `reviews` count and saves it
  // back through the same products module above, so the new average
  // shows up immediately on the product card.
  // ============================================================
  try{

  const PRODUCT_REVIEWS_KEY = 'genz_product_reviews_v1';
  function loadProductReviews(){
    try{
      const raw = localStorage.getItem(PRODUCT_REVIEWS_KEY);
      if(raw){ const parsed = JSON.parse(raw); if(parsed && typeof parsed === 'object') return parsed; }
    }catch(err){ console.warn('Could not read saved reviews', err); }
    return {}; // { [productId]: [{name, stars, comment, date}, ...] }
  }
  function saveProductReviews(all){
    try{ localStorage.setItem(PRODUCT_REVIEWS_KEY, JSON.stringify(all)); }
    catch(err){ console.warn('Could not save reviews', err); }
  }

  let selectedReviewStars = 0;
  const reviewOverlayEl = document.getElementById('reviewOverlay');
  const reviewStarPicker = document.getElementById('reviewStarPicker');
  const reviewForm = document.getElementById('reviewForm');
  const reviewMsgEl = document.getElementById('reviewMsg');

  function paintReviewStars(count){
    if(!reviewStarPicker) return;
    reviewStarPicker.querySelectorAll('.review-star-btn').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.star) <= count);
    });
  }

  function renderExistingReviews(productId){
    const wrap = document.getElementById('reviewExistingList');
    if(!wrap) return;
    const all = loadProductReviews();
    const list = (all[productId] || []).slice(0, 8);
    if(list.length === 0){
      wrap.innerHTML = '<p class="analytics-empty">No reviews yet for this piece — be the first!</p>';
      return;
    }
    wrap.innerHTML = list.map(r => `
      <div class="review-existing-item">
        <div class="review-existing-stars">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</div>
        <p class="review-existing-author">${escapeHtml(r.name)} · ${escapeHtml(r.date)}</p>
        <p class="review-existing-comment">${escapeHtml(r.comment)}</p>
      </div>
    `).join('');
  }

  window.openReviewModal = function(productId, productName){
    selectedReviewStars = 0;
    paintReviewStars(0);
    if(reviewForm) reviewForm.reset();
    if(reviewMsgEl){ reviewMsgEl.textContent = ''; reviewMsgEl.classList.remove('show','error'); }
    document.getElementById('reviewProductId').value = productId;
    const nameEl = document.getElementById('reviewProductName');
    if(nameEl) nameEl.textContent = `Share your experience with "${productName}".`;
    renderExistingReviews(productId);
    if(typeof window.openModal === 'function') window.openModal('reviewOverlay');
  };

  if(reviewStarPicker){
    reviewStarPicker.addEventListener('click', (e) => {
      const btn = e.target.closest('.review-star-btn');
      if(!btn) return;
      selectedReviewStars = Number(btn.dataset.star);
      paintReviewStars(selectedReviewStars);
    });
  }

  const reviewCloseBtn = document.getElementById('reviewClose');
  if(reviewCloseBtn && reviewOverlayEl){
    reviewCloseBtn.addEventListener('click', () => closeModal('reviewOverlay'));
    reviewOverlayEl.addEventListener('click', (e) => { if(e.target.id === 'reviewOverlay') closeModal('reviewOverlay'); });
  }

  if(reviewForm){
    reviewForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const productId = document.getElementById('reviewProductId').value;
      const name = document.getElementById('reviewName').value.trim();
      const comment = document.getElementById('reviewComment').value.trim();
      if(selectedReviewStars === 0){
        reviewMsgEl.textContent = 'Please pick a star rating before submitting.';
        reviewMsgEl.classList.add('show','error');
        return;
      }
      if(!name || !comment){
        reviewMsgEl.textContent = 'Please add your name and a short review.';
        reviewMsgEl.classList.add('show','error');
        return;
      }
      const all = loadProductReviews();
      if(!all[productId]) all[productId] = [];
      all[productId].unshift({ name, stars: selectedReviewStars, comment, date: new Date().toLocaleDateString() });
      saveProductReviews(all);

      // Recompute this product's average rating + review count and persist.
      if(window.__products){
        const items = window.__products.get();
        const idx = items.findIndex(p => p.id === productId);
        if(idx !== -1){
          const reviews = all[productId];
          const avg = reviews.reduce((s, r) => s + r.stars, 0) / reviews.length;
          items[idx] = { ...items[idx], rating: Math.round(avg * 10) / 10, reviews: reviews.length };
          window.__products.set(items);
          window.__products.render();
        }
      }

      reviewMsgEl.textContent = 'Thanks — your review has been posted!';
      reviewMsgEl.classList.remove('error');
      reviewMsgEl.classList.add('show');
      try{ playSound('success'); }catch(err){ /* sound module unavailable */ }
      renderExistingReviews(productId);
      reviewForm.reset();
      selectedReviewStars = 0;
      paintReviewStars(0);
      setTimeout(() => { reviewMsgEl.classList.remove('show'); }, 2500);
    });
  }

  }catch(err){ console.warn('Product reviews module setup failed', err); }

  // ============================================================
  // LIVE CHAT WIDGET — simple keyword-matched FAQ bot. No backend;
  // it just scans the visitor's message for known topics (shipping,
  // returns, sizing, payment, order tracking) and replies with a
  // canned answer, falling back to pointing at the contact email.
  // ============================================================
  try{

  const chatWidget = document.getElementById('chatWidget');
  const chatBubble = document.getElementById('chatBubble');
  const chatPanelClose = document.getElementById('chatPanelClose');
  const chatPanelBody = document.getElementById('chatPanelBody');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');

  const CHAT_FAQ = [
    { keywords: ['ship', 'delivery', 'deliver', 'arrive'], reply: "We ship worldwide — most orders arrive in 3–7 business days. You'll get a tracking link the moment your order is packed." },
    { keywords: ['return', 'refund', 'exchange'], reply: "Returns are accepted within 14 days of delivery, unworn and with tags on. Email support@example.com with your order number to start one." },
    { keywords: ['size', 'sizing', 'fit'], reply: "GEN_Z pieces run true to an oversized streetwear fit. Check the \"Size Guide\" link on any product card for exact measurements." },
    { keywords: ['track', 'order status', 'where is my order'], reply: "Tap \"Track Order\" in the nav and enter the email you used at checkout to see live status." },
    { keywords: ['payment', 'pay', 'card', 'jazzcash', 'stripe'], reply: "We accept card payments (Stripe), JazzCash, and bank transfer at checkout — all shown on the payment screen." },
    { keywords: ['discount', 'coupon', 'promo', 'code'], reply: "Keep an eye on our Newsletter for promo codes — you can apply any code in the cart before checking out." },
    { keywords: ['contact', 'human', 'agent', 'email'], reply: "You can always reach our team directly at support@example.com." },
    { keywords: ['hi', 'hello', 'hey'], reply: "Hey! 👋 Ask me about shipping, sizing, returns, payments, or order tracking." }
  ];

  function addChatMessage(text, from){
    if(!chatPanelBody) return;
    const el = document.createElement('div');
    el.className = 'chat-msg ' + (from === 'user' ? 'user' : 'bot');
    el.textContent = text;
    chatPanelBody.appendChild(el);
    chatPanelBody.scrollTop = chatPanelBody.scrollHeight;
  }

  function getBotReply(message){
    const lower = message.toLowerCase();
    const hit = CHAT_FAQ.find(entry => entry.keywords.some(kw => lower.includes(kw)));
    if(hit) return hit.reply;
    return "Thanks for the message! For anything specific to your order, email support@example.com and our team will get back to you shortly.";
  }

  let chatGreeted = false;
  function openChatWidget(){
    if(!chatWidget) return;
    chatWidget.classList.add('open');
    if(!chatGreeted){
      addChatMessage("Hi there! I'm the GEN_Z support bot. Ask me about shipping, sizing, returns, or your order.", 'bot');
      chatGreeted = true;
    }
    setTimeout(() => chatInput && chatInput.focus(), 150);
  }
  function closeChatWidget(){ if(chatWidget) chatWidget.classList.remove('open'); }

  if(chatBubble){
    chatBubble.addEventListener('click', () => {
      if(chatWidget && chatWidget.classList.contains('open')) closeChatWidget();
      else openChatWidget();
    });
  }
  if(chatPanelClose) chatPanelClose.addEventListener('click', closeChatWidget);

  if(chatForm){
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = chatInput.value.trim();
      if(!text) return;
      addChatMessage(text, 'user');
      chatInput.value = '';
      setTimeout(() => addChatMessage(getBotReply(text), 'bot'), 500);
    });
  }

  }catch(err){ console.warn('Live chat widget setup failed', err); }

  // ============================================================
  // ADMIN CONTROL PANEL MODULE
  // Add / Edit / Archive (delete) products through a real form UI.
  // Everything reads/writes the shared `products` array exposed via
  // window.__products above, then re-renders the storefront grid.
  // ============================================================
  try{

  const adminOverlay = document.getElementById('adminOverlay');
  const adminForm = document.getElementById('adminProductForm');
  const adminToast = document.getElementById('adminToast');
  let toastTimer = null;

  function showAdminToast(msg){
    if(!adminToast) return;
    adminToast.textContent = msg;
    adminToast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => adminToast.classList.remove('show'), 2600);
  }

  function resetAdminForm(){
    if(!adminForm) return;
    adminForm.reset();
    document.getElementById('apId').value = '';
    document.getElementById('apSubmitBtn').textContent = 'Add Product';
    document.getElementById('apCancelEdit').style.display = 'none';
    document.getElementById('adminFormTitle').textContent = 'Add New Product';
    document.getElementById('adminFormHint').textContent = 'Fill in the details below to drop a new piece straight into the shop grid.';
    updateImagePreview('apImage', 'apImagePreview');
  }

  wireImageField('apImage', 'apImageFile', 'apImagePreview');

  function renderAdminList(){
    const list = document.getElementById('adminProductList');
    const countEl = document.getElementById('adminProductCount');
    if(!list || !window.__products) return;
    const items = window.__products.get();
    if(countEl) countEl.textContent = items.length;
    if(items.length === 0){
      list.innerHTML = '<p class="admin-empty-note">No products yet — add your first drop using the form.</p>';
      return;
    }
    list.innerHTML = items.map(p => `
      <div class="admin-product-row" data-row-id="${escapeHtml(p.id)}">
        <input type="checkbox" class="admin-row-checkbox" data-select-id="${escapeHtml(p.id)}" aria-label="Select ${escapeHtml(p.name)} for bulk actions">
        <div class="admin-product-thumb"><img src="${escapeHtml(p.image || '')}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none';"></div>
        <div class="admin-product-info">
          <h4>${escapeHtml(p.name)}${p.tag ? ' · ' + escapeHtml(p.tag) : ''}</h4>
          <p>$${p.price} <span style="opacity:0.6;">(USD base)</span> · ${escapeHtml(p.category)} · ${p.stock} in stock</p>
        </div>
        <div class="admin-content-actions">
          <button type="button" class="admin-labeled-btn admin-edit-row" data-id="${escapeHtml(p.id)}" aria-label="Edit ${escapeHtml(p.name)}"><i data-lucide="pencil"></i>Edit</button>
          <button type="button" class="admin-labeled-btn danger admin-delete-row" data-id="${escapeHtml(p.id)}" aria-label="Archive ${escapeHtml(p.name)}"><i data-lucide="archive"></i>Archive</button>
        </div>
      </div>
    `).join('');
    refreshIcons();
    try{ if(typeof refreshBulkActionState === 'function') refreshBulkActionState(); }catch(err){ /* bulk module not ready yet */ }
  }

  // ============================================================
  // BULK ACTIONS — select multiple products in the catalog list and
  // archive (delete) them all in one go.
  // ============================================================
  const selectedProductIds = new Set();
  function refreshBulkActionState(){
    const bulkBtn = document.getElementById('adminBulkArchiveBtn');
    const bulkCount = document.getElementById('adminBulkCount');
    const selectAll = document.getElementById('adminSelectAll');
    // Selected ids that no longer exist in the current list (e.g. already
    // archived) shouldn't keep the button enabled.
    const currentIds = new Set((window.__products ? window.__products.get() : []).map(p => p.id));
    Array.from(selectedProductIds).forEach(id => { if(!currentIds.has(id)) selectedProductIds.delete(id); });
    document.querySelectorAll('.admin-row-checkbox').forEach(cb => {
      cb.checked = selectedProductIds.has(cb.dataset.selectId);
      const row = cb.closest('.admin-product-row');
      if(row) row.classList.toggle('selected', cb.checked);
    });
    if(bulkBtn) bulkBtn.disabled = selectedProductIds.size === 0;
    if(bulkCount) bulkCount.textContent = String(selectedProductIds.size);
    if(selectAll) selectAll.checked = currentIds.size > 0 && selectedProductIds.size === currentIds.size;
  }
  const adminProductListEl = document.getElementById('adminProductList');
  if(adminProductListEl){
    adminProductListEl.addEventListener('change', (e) => {
      const cb = e.target.closest('.admin-row-checkbox');
      if(!cb) return;
      if(cb.checked) selectedProductIds.add(cb.dataset.selectId);
      else selectedProductIds.delete(cb.dataset.selectId);
      refreshBulkActionState();
    });
  }
  const adminSelectAllEl = document.getElementById('adminSelectAll');
  if(adminSelectAllEl){
    adminSelectAllEl.addEventListener('change', () => {
      const items = window.__products ? window.__products.get() : [];
      if(adminSelectAllEl.checked) items.forEach(p => selectedProductIds.add(p.id));
      else selectedProductIds.clear();
      refreshBulkActionState();
    });
  }
  const adminBulkArchiveBtn = document.getElementById('adminBulkArchiveBtn');
  if(adminBulkArchiveBtn){
    adminBulkArchiveBtn.addEventListener('click', () => {
      if(selectedProductIds.size === 0 || !window.__products) return;
      const count = selectedProductIds.size;
      if(!confirm(`Archive ${count} selected product${count === 1 ? '' : 's'}? This can't be undone.`)) return;
      const remaining = window.__products.get().filter(p => !selectedProductIds.has(p.id));
      window.__products.set(remaining);
      window.__products.render();
      selectedProductIds.clear();
      renderAdminList();
      try{ showAdminToast(`Archived ${count} product${count === 1 ? '' : 's'}.`); }catch(err){ /* toast unavailable */ }
    });
  }

  const refreshOrdersBtn=document.getElementById('refreshOrdersBtn');
  if(refreshOrdersBtn) refreshOrdersBtn.addEventListener('click', renderAdminOrders);


  // ============================================================
  // LIVE ADMIN ORDERS
  // Reads orders from MySQL and lets the admin update fulfillment status.
  // ============================================================
  async function renderAdminOrders(){
    const wrap=document.getElementById('adminOrdersList');
    if(!wrap) return;
    wrap.innerHTML='<p class="form-hint">Loading orders…</p>';
    try{
      if(!window.__genzBackend || !getAdminToken()) throw new Error('Admin session required');
      const orders=await window.__genzBackend.fetchOrders();
      if(!Array.isArray(orders)||!orders.length){
        wrap.innerHTML='<p class="form-hint">No orders yet.</p>'; return;
      }
      wrap.innerHTML=orders.map(o=>{
        const buyer=o.buyer||{};
        const items=(o.items||[]).map(i=>`${i.name} × ${i.qty||1}`).join(', ');
        const status=o.status||'pending';
        return `<div class="admin-order-card" style="border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:12px;background:rgba(255,255,255,.03)">
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <strong>#${o.order_number||o.orderNumber}</strong>
            <span>${String(o.method||'').toUpperCase()}</span>
          </div>
          <div style="margin:8px 0"><strong>${buyer.name||''}</strong> · ${buyer.phone||''} · ${buyer.email||''}<br>${buyer.address||''}, ${buyer.city||''} ${buyer.postal||''}</div>
          <div style="font-size:.9rem;opacity:.85">${items}</div>
          <div style="display:flex;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap">
            <span>Status:</span>
            <select class="admin-order-status" data-order="${o.order_number||o.orderNumber}">
              ${['pending','confirmed','processing','shipped','out_for_delivery','delivered','cancelled'].map(st=>`<option value="${st}" ${st===status?'selected':''}>${st.replaceAll('_',' ')}</option>`).join('')}
            </select>
            <span style="margin-left:auto">Order #${o.order_number||o.orderNumber}</span>
          </div>
        </div>`;
      }).join('');
      wrap.querySelectorAll('.admin-order-status').forEach(sel=>{
        sel.addEventListener('change', async ()=>{
          try{
            await window.__genzBackend.updateOrderStatus(sel.dataset.order, sel.value);
            showAdminToast('Order status updated.');
          }catch(err){ alert('Could not update order status.'); renderAdminOrders(); }
        });
      });
    }catch(err){
      wrap.innerHTML='<p class="form-hint">Could not load live orders. Check the backend/database connection.</p>';
    }
  }

  // ============================================================
  // ANALYTICS DASHBOARD — reads the orders saved during checkout
  // (loadOrders(), same store the Track Order modal uses) and turns
  // them into revenue / order-count / top-product stats. Nothing here
  // needs its own storage — it's a live view over existing order data.
  // ============================================================
  async function renderAnalytics(){
    const statGrid = document.getElementById('analyticsStatGrid');
    const topWrap = document.getElementById('analyticsTopProducts');
    const ordersWrap = document.getElementById('analyticsOrdersList');
    if(!statGrid || typeof loadOrders !== 'function') return;
    let orders = loadOrders();
    try{
      if(window.__genzBackend && getAdminToken()){
        const remote = await window.__genzBackend.fetchOrders();
        if(Array.isArray(remote)) orders = remote.map(o => ({
          orderNumber: o.order_number || o.orderNumber,
          buyerEmail: (o.buyer && o.buyer.email) || '',
          date: o.created_at || new Date().toISOString(),
          items: o.items || [],
          total: (o.items || []).reduce((sum, it) => sum + (Number(it.price_usd || it.price) || 0) * (Number(it.qty) || 1), 0)
        }));
      }
    }catch(err){ console.warn('Remote analytics unavailable; using local orders.', err); }
    const totalRevenue = orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const totalOrders = orders.length;
    const avgOrder = totalOrders ? totalRevenue / totalOrders : 0;
    const uniqueCustomers = new Set(orders.map(o => o.buyerEmail)).size;

    statGrid.innerHTML = `
      <div class="analytics-stat-card"><p class="stat-label">Total Revenue</p><p class="stat-value">$${totalRevenue.toFixed(2)}</p></div>
      <div class="analytics-stat-card"><p class="stat-label">Total Orders</p><p class="stat-value">${totalOrders}</p></div>
      <div class="analytics-stat-card"><p class="stat-label">Avg. Order Value</p><p class="stat-value">$${avgOrder.toFixed(2)}</p></div>
      <div class="analytics-stat-card"><p class="stat-label">Unique Customers</p><p class="stat-value">${uniqueCustomers}</p></div>
    `;

    // Low stock alerts — anything at or below 5 units (soldOut counts too),
    // pulled live from the same catalog the Products tab edits, so fixing
    // stock there clears the alert here automatically.
    const lowStockWrap = document.getElementById('analyticsLowStock');
    if(lowStockWrap){
      const catalog = window.__products ? window.__products.get() : [];
      const low = catalog.filter(p => Number(p.stock) <= 5).sort((a,b) => Number(a.stock) - Number(b.stock));
      if(!low.length){
        lowStockWrap.innerHTML = '<p class="analytics-empty">Everything is well stocked — nothing at 5 units or below.</p>';
      } else {
        lowStockWrap.innerHTML = low.map(p => `
          <div class="analytics-bar-row">
            <span class="bar-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
            <span style="font-size:0.78rem;font-weight:700;color:${Number(p.stock) === 0 ? '#a3453f' : 'var(--accent-warm)'};">
              ${Number(p.stock) === 0 ? 'Sold Out' : p.stock + ' left'}
            </span>
          </div>
        `).join('');
      }
    }

    // Tally quantity sold per product name across every order's line items.
    const qtyByName = {};
    orders.forEach(o => (o.items || []).forEach(it => {
      qtyByName[it.name] = (qtyByName[it.name] || 0) + (Number(it.qty) || 1);
    }));
    const topList = Object.entries(qtyByName).sort((a,b) => b[1] - a[1]).slice(0, 6);
    if(topWrap){
      if(topList.length === 0){
        topWrap.innerHTML = '<p class="analytics-empty">No orders yet — stats will appear here once customers start checking out.</p>';
      } else {
        const maxQty = topList[0][1];
        topWrap.innerHTML = topList.map(([name, qty]) => `
          <div class="analytics-bar-row">
            <span class="bar-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
            <span class="analytics-bar-track"><span class="analytics-bar-fill" style="width:${Math.max(6, (qty / maxQty) * 100)}%"></span></span>
            <span class="analytics-bar-qty">${qty}</span>
          </div>
        `).join('');
      }
    }

    if(ordersWrap){
      if(orders.length === 0){
        ordersWrap.innerHTML = '<p class="analytics-empty">No orders placed yet.</p>';
      } else {
        ordersWrap.innerHTML = `
          <table class="analytics-orders-table">
            <thead><tr><th>Order #</th><th>Customer</th><th>Total</th><th>Date</th></tr></thead>
            <tbody>
              ${orders.slice(0, 10).map(o => `
                <tr>
                  <td>${escapeHtml(o.orderNumber || '—')}</td>
                  <td>${escapeHtml(o.buyerEmail || '—')}</td>
                  <td>$${(Number(o.total) || 0).toFixed(2)}</td>
                  <td>${escapeHtml(new Date(o.date).toLocaleDateString())}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
    }
  }
  window.__renderAnalytics = renderAnalytics;

  // Renders the login "database" (name/email/password/provider/date) into
  // the Admin Panel → Users tab. Data comes from localStorage, written by
  // recordLogin() whenever someone signs in as a buyer or via Google.
  function renderAdminUsersList(){
    const body = document.getElementById('adminUsersTableBody');
    const countEl = document.getElementById('adminUsersCount');
    const emptyEl = document.getElementById('adminUsersEmpty');
    if(!body) return;
    const records = (typeof window.__loadLoginRecords === 'function') ? window.__loadLoginRecords() : [];
    if(countEl) countEl.textContent = records.length;
    if(records.length === 0){
      body.innerHTML = '';
      if(emptyEl) emptyEl.style.display = 'block';
      return;
    }
    if(emptyEl) emptyEl.style.display = 'none';
    body.innerHTML = records.map(r => `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px 10px;">${escapeHtml(r.name || '—')}</td>
        <td style="padding:8px 10px;">${escapeHtml(r.email || '—')}</td>
        <td style="padding:8px 10px;color:var(--muted-foreground);"><i data-lucide="lock" style="width:12px;height:12px;vertical-align:-2px;margin-right:4px;"></i>Hashed</td>
        <td style="padding:8px 10px;">${escapeHtml(r.provider || '—')}</td>
        <td style="padding:8px 10px;">${escapeHtml(r.date || '—')}</td>
      </tr>
    `).join('');
  }
  window.__renderAdminUsersList = renderAdminUsersList;

  const adminUsersClearBtn = document.getElementById('adminUsersClearBtn');
  if(adminUsersClearBtn){
    adminUsersClearBtn.addEventListener('click', async () => {
      if(!window.confirm('Clear every recorded sign-in? This cannot be undone.')) return;
      try{
        if(window.__genzBackend) await window.__genzBackend.clearLoginRecords();
        localStorage.removeItem('genz_login_records_v1');
        renderAdminUsersList();
        showAdminToast('User sign-in records cleared.');
      }catch(err){
        console.warn('Could not clear remote login records', err);
        showAdminToast('Could not clear server records.');
      }
      try{ playSound('click'); }catch(err){}
    });
  }

  window.openAdminEditForm = function(id){
    const items = window.__products.get();
    const p = items.find(x => x.id === id);
    if(!p) return;
    document.getElementById('apId').value = p.id;
    document.getElementById('apName').value = p.name;
    document.getElementById('apPrice').value = p.price;
    document.getElementById('apCategory').value = p.category;
    document.getElementById('apTag').value = p.tag || '';
    document.getElementById('apStock').value = p.stock;
    document.getElementById('apSizes').value = Array.isArray(p.sizes) ? p.sizes.join(', ') : '';
    document.getElementById('apImage').value = p.image || '';
    updateImagePreview('apImage', 'apImagePreview');
    document.getElementById('apSubmitBtn').textContent = 'Save Changes';
    document.getElementById('apCancelEdit').style.display = 'inline-flex';
    document.getElementById('adminFormTitle').textContent = 'Edit Product';
    document.getElementById('adminFormHint').textContent = `Editing "${p.name}". Update any field and save to apply changes instantly.`;
    if(adminOverlay){ adminOverlay.classList.add('open'); }
    const nameInput = document.getElementById('apName');
    if(nameInput) nameInput.focus();
  };

  window.deleteProduct = function(id){
    const items = window.__products.get();
    const p = items.find(x => x.id === id);
    if(!p) return;
    if(!window.confirm(`Archive "${p.name}"? This removes it from the shop grid.`)) return;
    const next = items.filter(x => x.id !== id);
    window.__products.set(next);
    window.__products.render();
    renderAdminList();
    showAdminToast(`Archived "${p.name}"`);
    try{ playSound('click'); }catch(err){ /* sound module unavailable */ }
  };

  if(adminForm){
    adminForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('apId').value;
      const name = document.getElementById('apName').value.trim();
      const price = Number(document.getElementById('apPrice').value);
      const category = document.getElementById('apCategory').value;
      const tag = document.getElementById('apTag').value;
      const stock = Number(document.getElementById('apStock').value);
      const image = document.getElementById('apImage').value.trim();
      const sizes = document.getElementById('apSizes').value.trim()
        .split(',').map(s => s.trim()).filter(Boolean);
      if(!name || Number.isNaN(price) || Number.isNaN(stock)){ return; }

      const items = window.__products.get();
      if(id){
        // Editing an existing product in place.
        const next = items.map(p => p.id === id ? { ...p, name, price, category, tag, stock, image, sizes } : p);
        window.__products.set(next);
        showAdminToast(`Updated "${name}"`);
      } else {
        // Adding a brand new product — appended to the catalog and
        // instantly reflected on the storefront grid.
        const newProduct = { id: 'p' + Date.now(), name, price, category, tag, stock, image, sizes };
        window.__products.set([...items, newProduct]);
        showAdminToast(`Added "${name}" to the shop`);
      }
      window.__products.render();
      renderAdminList();
      resetAdminForm();
      try{ playSound('add'); }catch(err){ /* sound module unavailable */ }
    });
  }

  const apCancelBtn = document.getElementById('apCancelEdit');
  if(apCancelBtn) apCancelBtn.addEventListener('click', resetAdminForm);

  // ============================================================
  // DISCOUNT CODES — Admin Panel → Discounts tab
  // Same add/edit/delete pattern as the Products tab above, just
  // against the discountCodes array instead of the product catalog.
  // ============================================================
  const adminDiscountForm = document.getElementById('adminDiscountForm');

  function resetDiscountForm(){
    if(!adminDiscountForm) return;
    adminDiscountForm.reset();
    document.getElementById('adcOriginalCode').value = '';
    document.getElementById('adcSubmitBtn').textContent = 'Add Code';
    document.getElementById('adcCancelEdit').style.display = 'none';
    document.getElementById('adcFormTitle').textContent = 'Add Discount Code';
    document.getElementById('adcFormHint').textContent = 'Create a code shoppers can enter in the cart at checkout.';
  }

  function renderAdminDiscountList(){
    const list = document.getElementById('adminDiscountList');
    const countEl = document.getElementById('adminDiscountCount');
    if(!list) return;
    if(countEl) countEl.textContent = discountCodes.length;
    if(!discountCodes.length){
      list.innerHTML = '<p class="admin-empty-note">No discount codes yet — add one using the form.</p>';
    } else {
      list.innerHTML = discountCodes.map(d => `
        <div class="admin-content-row">
          <div class="admin-content-thumb"><i data-lucide="tag"></i></div>
          <div class="admin-content-info">
            <h4>${escapeHtml(d.code)}</h4>
            <p>${escapeHtml(d.label)} · ${d.type === 'percent' ? d.value + '% off' : '$' + d.value + ' off'}</p>
          </div>
          <div class="admin-content-actions">
            <button type="button" class="admin-labeled-btn" data-adc-edit="${escapeHtml(d.code)}"><i data-lucide="pencil"></i>Edit</button>
            <button type="button" class="admin-labeled-btn danger" data-adc-delete="${escapeHtml(d.code)}"><i data-lucide="trash-2"></i>Delete</button>
          </div>
        </div>`).join('');
    }
    refreshIcons();
  }
  window.__renderAdminDiscountList = renderAdminDiscountList;

  if(adminDiscountForm){
    adminDiscountForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const originalCode = document.getElementById('adcOriginalCode').value;
      const code = document.getElementById('adcCode').value.trim().toUpperCase();
      const type = document.getElementById('adcType').value;
      const value = Number(document.getElementById('adcValue').value);
      const label = document.getElementById('adcLabel').value.trim();
      if(!code || !label || Number.isNaN(value)) return;
      // A code must stay unique — block saving if it collides with a
      // different existing code (editing the same code back in is fine).
      const collision = discountCodes.some(d => d.code === code && d.code !== originalCode);
      if(collision){
        showAdminToast(`"${code}" is already in use — pick a different code.`);
        return;
      }
      if(originalCode){
        discountCodes = discountCodes.map(d => d.code === originalCode ? { code, type, value, label } : d);
        showAdminToast(`Updated code "${code}"`);
      } else {
        discountCodes = [...discountCodes, { code, type, value, label }];
        showAdminToast(`Added code "${code}"`);
      }
      saveDiscounts();
      renderAdminDiscountList();
      resetDiscountForm();
      try{ playSound('add'); }catch(err){ /* sound module unavailable */ }
    });
  }

  const adcCancelBtn = document.getElementById('adcCancelEdit');
  if(adcCancelBtn) adcCancelBtn.addEventListener('click', resetDiscountForm);

  const adminDiscountListEl = document.getElementById('adminDiscountList');
  if(adminDiscountListEl){
    adminDiscountListEl.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-adc-edit]');
      const delBtn = e.target.closest('[data-adc-delete]');
      if(editBtn){
        const d = discountCodes.find(x => x.code === editBtn.dataset.adcEdit);
        if(!d) return;
        document.getElementById('adcOriginalCode').value = d.code;
        document.getElementById('adcCode').value = d.code;
        document.getElementById('adcType').value = d.type;
        document.getElementById('adcValue').value = d.value;
        document.getElementById('adcLabel').value = d.label;
        document.getElementById('adcSubmitBtn').textContent = 'Save Changes';
        document.getElementById('adcCancelEdit').style.display = 'inline-flex';
        document.getElementById('adcFormTitle').textContent = 'Edit Discount Code';
        document.getElementById('adcFormHint').textContent = `Editing "${d.code}".`;
        document.getElementById('adcCode').focus();
      } else if(delBtn){
        const code = delBtn.dataset.adcDelete;
        if(!window.confirm(`Delete discount code "${code}"?`)) return;
        discountCodes = discountCodes.filter(d => d.code !== code);
        saveDiscounts();
        renderAdminDiscountList();
        showAdminToast(`Deleted code "${code}"`);
        try{ playSound('click'); }catch(err){ /* sound module unavailable */ }
      }
    });
  }

  const adminPanelBtn = document.getElementById('adminPanelBtn');
  if(adminPanelBtn){
    adminPanelBtn.addEventListener('click', () => {
      // Button is always visible now, so it has to work for both cases:
      // no admin session yet → send them to the unified Sign In form
      // (entering the admin email/password there triggers the PIN check);
      // already an admin → open the dashboard directly.
      if(!isAdmin){
        showScreen('login');
        return;
      }
      renderAdminList();
      try{ if(window.__content){ window.__content.renderAdminOfferingsList(); window.__content.renderAdminCrewList(); window.__content.renderAdminAdsList(); } }catch(err){ /* content module unavailable */ }
      renderAdminUsersList();
      if(adminOverlay) adminOverlay.classList.add('open');
    });
  }

  // ---------- Admin nav button UI helper ----------
  // Admin sign-in happens through the same Sign In form as everyone else
  // (email + password, then the PIN check). This button is hidden by CSS
  // until an admin session is active, at which point it works purely as
  // a quick "Logout" shortcut next to the Admin Panel button.
  const navAdminLoginBtn = document.getElementById('navAdminLoginBtn');
  function updateAdminNavButtonUI(){
    if(!navAdminLoginBtn) return;
    const label = navAdminLoginBtn.querySelector('.login-label');
    if(isAdmin){
      navAdminLoginBtn.classList.add('logged-in');
      if(label) label.textContent = 'Admin Logout';
      navAdminLoginBtn.setAttribute('title', 'Admin Logout');
      navAdminLoginBtn.setAttribute('aria-label', 'Log out of admin panel');
    } else {
      navAdminLoginBtn.classList.remove('logged-in');
      if(label) label.textContent = 'Admin Login';
      navAdminLoginBtn.setAttribute('title', 'Admin Login');
      navAdminLoginBtn.setAttribute('aria-label', 'Admin login');
    }
  }
  updateAdminNavButtonUI();
  if(navAdminLoginBtn){
    navAdminLoginBtn.addEventListener('click', () => {
      isAdmin = false;
      document.body.classList.remove('is-admin');
      if(adminOverlay) adminOverlay.classList.remove('open');
      try{ playSound('click'); }catch(err){ /* sound module unavailable */ }
      try{ showAdminToast('Logged out of admin panel.'); }catch(err){ /* toast unavailable */ }
      updateAdminNavButtonUI();
    });
  }

  // ---------- Admin dashboard tab switching (Products / Offerings / Crew / Ads) ----------
  // Everything here lives inside one Admin Control Panel now, instead of
  // scattered edit buttons across the live page.
  const adminTabs = document.getElementById('adminTabs');
  if(adminTabs){
    adminTabs.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.admin-tab-btn');
      if(!tabBtn) return;
      const target = tabBtn.dataset.adminTab;
      adminTabs.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.toggle('active', b === tabBtn));
      document.querySelectorAll('[data-admin-panel]').forEach(p => p.classList.toggle('active', p.dataset.adminPanel === target));
      try{
        if(window.__content){
          if(target === 'offerings') window.__content.renderAdminOfferingsList();
          else if(target === 'crew') window.__content.renderAdminCrewList();
          else if(target === 'ads') window.__content.renderAdminAdsList();
        }
        if(target === 'users' && typeof window.__renderAdminUsersList === 'function'){
          window.__renderAdminUsersList();
          // Pull every device's sign-ins from the backend, then re-render
          // with the complete list once it arrives.
          if(typeof window.__syncLoginRecordsFromBackend === 'function'){
            window.__syncLoginRecordsFromBackend().then(() => window.__renderAdminUsersList());
          }
        }
        if(target === 'analytics' && typeof window.__renderAnalytics === 'function') window.__renderAnalytics();
        if(target === 'discounts' && typeof window.__renderAdminDiscountList === 'function') window.__renderAdminDiscountList();
        if(target === 'hero') refreshAdminHeroField();
      }catch(err){ /* content module unavailable */ }
    });
  }
  const adminDashBack = document.getElementById('adminDashBack');
  if(adminDashBack) adminDashBack.addEventListener('click', () => {
    if(adminOverlay) adminOverlay.classList.remove('open');
    resetAdminForm();
  });

  const adminDashClose = document.getElementById('adminDashClose');
  if(adminDashClose) adminDashClose.addEventListener('click', () => {
    if(adminOverlay) adminOverlay.classList.remove('open');
    resetAdminForm();
  });
  const adminLogoutBtn = document.getElementById('adminLogoutBtn');
  if(adminLogoutBtn) adminLogoutBtn.addEventListener('click', () => {
    isAdmin = false;
    document.body.classList.remove('is-admin');
    updateAdminNavButtonUI();
    if(adminOverlay) adminOverlay.classList.remove('open');
    resetAdminForm();
    try{ playSound('click'); }catch(err){ /* sound module unavailable */ }
    try{ showAdminToast('Logged out of admin panel.'); }catch(err){ /* toast unavailable */ }
    showScreen('main');
  });
  if(adminOverlay){
    adminOverlay.addEventListener('click', (e) => {
      if(e.target.id === 'adminOverlay'){ adminOverlay.classList.remove('open'); resetAdminForm(); }
    });
    // Delegated edit/archive buttons inside the admin product list.
    adminOverlay.addEventListener('click', (e) => {
      const editRow = e.target.closest('.admin-edit-row');
      const delRow = e.target.closest('.admin-delete-row');
      if(editRow) window.openAdminEditForm(editRow.dataset.id);
      else if(delRow) window.deleteProduct(delRow.dataset.id);
    });
  }

  window.__renderAdminList = renderAdminList;

  }catch(err){ console.warn('Admin panel module setup failed', err); }

  // ============================================================
  // TEAM ("The Crew") & SERVICES ("What We Do") CONTENT MODULE
  // Both sections render from small JS arrays, persist to
  // localStorage, and can be added/edited/removed by the admin
  // through the shared Quick Edit modal.
  // ============================================================
  try{

  const TEAM_KEY = 'genz_team_v1';
  const SERVICES_KEY = 'genz_services_v1';

  const DEFAULT_TEAM = [
    { id:'t1', name:'Maya Torres', role:'Creative Director', photo:'' },
    { id:'t2', name:'Kenji Osei', role:'Head of Design', photo:'' },
    { id:'t3', name:'Priya Chandran', role:'Pattern Cutter', photo:'' },
    { id:'t4', name:'Elias Novak', role:'Production Lead', photo:'' },
    { id:'t5', name:'Sara Malik', role:'Social & Marketing', photo:'' }
  ];

  const DEFAULT_SERVICES = [
    { id:'s1', icon:'layers', title:'Collections', desc:"Seasonal lines built around a single idea, cut and sampled in-house before they ever hit a rack." },
    { id:'s2', icon:'zap', title:'Limited Drops', desc:"Small-batch releases announced with no warning. Once they're gone, they're archived, not restocked." },
    { id:'s3', icon:'scissors', title:'Custom Pieces', desc:"One-to-one commissions for artists, athletes, and anyone building a wardrobe that can't be bought off a shelf." },
    { id:'s4', icon:'sparkles', title:'Style Consulting', desc:"Personal styling sessions — perfume, denim, and layering picks matched to how you actually move through your day." }
  ];

  function loadList(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      if(raw){ const parsed = JSON.parse(raw); if(Array.isArray(parsed) && parsed.length) return parsed; }
    }catch(err){ console.warn('Could not read ' + key, err); }
    return fallback.map(x => ({...x}));
  }
  function saveList(key, list){
    try{ localStorage.setItem(key, JSON.stringify(list)); }catch(err){ console.warn('Could not save ' + key, err); }
  }

  let teamMembers = loadList(TEAM_KEY, DEFAULT_TEAM);
  let services = loadList(SERVICES_KEY, DEFAULT_SERVICES);

  // ---------- Ad slots: About carousel, Crew grid, What We Do grid ----------
  const ABOUT_ADS_KEY = 'genz_ads_about_v1';
  const TEAM_ADS_KEY = 'genz_ads_team_v1';
  const SERVICE_ADS_KEY = 'genz_ads_services_v1';
  const HERO_IMAGE_KEY = 'genz_hero_image_v1';

  const DEFAULT_ABOUT_ADS = [
    { id:'aa1', eyebrow:'Studio, Berlin — 2025', title:'The Craft Behind Every Drop', image:'https://images.unsplash.com/photo-1552346154-21d32810aba3?w=800&h=1000&fit=crop' },
    { id:'aa2', eyebrow:'Now Available', title:'Signature Noir Perfume', image:'https://images.unsplash.com/photo-1587017539504-67cfbddac569?w=800&h=1000&fit=crop' },
    { id:'aa3', eyebrow:'Trending', title:'Baggy Cargo Jeans — 12 Left', image:'https://images.unsplash.com/photo-1490578474895-699cd4e2cf59?w=800&h=1000&fit=crop' }
  ];
  const DEFAULT_TEAM_ADS = [];
  const DEFAULT_SERVICE_ADS = [];

  let aboutAds = loadList(ABOUT_ADS_KEY, DEFAULT_ABOUT_ADS);
  let teamAds = loadList(TEAM_ADS_KEY, DEFAULT_TEAM_ADS);
  let serviceAds = loadList(SERVICE_ADS_KEY, DEFAULT_SERVICE_ADS);
  let aboutAdIndex = 0;

  // ---------- Hero flatlay photo (single image, admin-editable) ----------
  const DEFAULT_HERO_IMAGE = 'https://images.unsplash.com/photo-1543422655-ac1c6ca993ed?w=1000&h=560&fit=crop';
  function loadHeroImage(){
    try{ return localStorage.getItem(HERO_IMAGE_KEY) || DEFAULT_HERO_IMAGE; }
    catch(err){ return DEFAULT_HERO_IMAGE; }
  }
  function applyHeroImage(){
    const img = document.getElementById('heroFlatlayImg');
    if(img) img.src = loadHeroImage();
  }
  applyHeroImage();

  // Homepage tab (admin dashboard) — same hero photo control as the
  // on-page pencil Edit button, wired once since this form's HTML is
  // static (not re-injected like the Quick Edit modal's fields).
  function refreshAdminHeroField(){
    const input = document.getElementById('ahImage');
    if(input){ input.value = loadHeroImage(); updateImagePreview('ahImage', 'ahImagePreview'); }
  }
  wireImageField('ahImage', 'ahImageFile', 'ahImagePreview');
  refreshAdminHeroField();

  function renderAboutAds(){
    const host = document.getElementById('aboutAdCarousel');
    if(!host) return;
    if(!aboutAds.length){
      host.innerHTML = '<div class="about-ad-slide active" style="background:linear-gradient(135deg,#221f1c,#4a3f2f);"><p class="promo-ad-eyebrow">GEN_Z</p><p class="promo-ad-title">Add your first About image</p></div>';
      return;
    }
    aboutAdIndex = aboutAdIndex % aboutAds.length;
    host.innerHTML = aboutAds.map((a, i) => `
      <div class="about-ad-slide${i === aboutAdIndex ? ' active' : ''}" style="background-image:url('${escapeHtml(a.image)}');">
        <p class="promo-ad-eyebrow">${escapeHtml(a.eyebrow)}</p>
        <p class="promo-ad-title">${escapeHtml(a.title).replace(/\n/g,'<br>')}</p>
      </div>
    `).join('') + `
      <div class="about-ad-dots">${aboutAds.map((_, i) => `<span class="${i === aboutAdIndex ? 'active' : ''}"></span>`).join('')}</div>`;
  }
  window.renderAboutAds = renderAboutAds;
  window.__aboutAdsState = { get index(){ return aboutAdIndex; }, set index(v){ aboutAdIndex = v; }, get list(){ return aboutAds; } };

  function renderTeam(){
    const grid = document.getElementById('teamGrid');
    if(!grid) return;
    grid.innerHTML = teamMembers.map(t => `
      <div class="team-card" data-id="${escapeHtml(t.id)}">
        <button type="button" class="content-edit-btn" data-type="team" data-id="${escapeHtml(t.id)}" aria-label="Edit ${escapeHtml(t.name)}"><i data-lucide="pencil"></i>Edit</button>
        <div class="team-photo"${t.photo ? ` style="background-image:url('${escapeHtml(t.photo)}');"` : ''}></div>
        <div class="team-info"><h4>${escapeHtml(t.name)}</h4><p>${escapeHtml(t.role)}</p></div>
      </div>
    `).join('') + teamAds.map(a => `
      <div class="team-card grid-ad-card" data-ad-id="${escapeHtml(a.id)}" style="background-image:url('${escapeHtml(a.image)}');">
        <span class="ad-badge">Ad</span>
        <button type="button" class="content-edit-btn" data-type="team-ad" data-id="${escapeHtml(a.id)}" aria-label="Edit ad"><i data-lucide="pencil"></i>Edit</button>
        <p class="promo-ad-eyebrow">${escapeHtml(a.eyebrow)}</p>
        <p class="promo-ad-title">${escapeHtml(a.title)}</p>
      </div>
    `).join('') + `
      <div class="team-card add-card-tile" data-type="team" id="addTeamTile">
        <i data-lucide="plus"></i><span>Add Crew Member</span>
      </div>
      <div class="team-card add-card-tile ad-tile" data-type="team-ad" id="addTeamAdTile">
        <i data-lucide="megaphone"></i><span>Add Ad</span>
      </div>`;
    refreshIcons();
    try{ if(typeof applyReveal === 'function') applyReveal(grid.querySelectorAll('.team-card')); }catch(err){ /* reveal module not ready yet */ }
  }

  function renderServices(){
    const grid = document.getElementById('servicesGrid');
    if(!grid) return;
    grid.innerHTML = services.map((s, i) => {
      const hasImage = !!(s.image && s.image.trim());
      const imgStyle = hasImage ? ` style="background-image:url('${escapeHtml(s.image)}');"` : '';
      return `
      <div class="service-card${hasImage ? ' has-image' : ''}" data-id="${escapeHtml(s.id)}"${imgStyle}>
        <button type="button" class="content-edit-btn" data-type="service" data-id="${escapeHtml(s.id)}" aria-label="Edit ${escapeHtml(s.title)}"><i data-lucide="pencil"></i>Edit</button>
        <span class="service-num">${String(i + 1).padStart(2, '0')}</span>
        <i data-lucide="${escapeHtml(s.icon || 'layers')}"></i>
        <h3>${escapeHtml(s.title)}</h3>
        <p>${escapeHtml(s.desc)}</p>
      </div>`;
    }).join('') + serviceAds.map(a => `
      <div class="service-card grid-ad-card" data-ad-id="${escapeHtml(a.id)}" style="background-image:url('${escapeHtml(a.image)}');min-height:220px;">
        <span class="ad-badge">Ad</span>
        <button type="button" class="content-edit-btn" data-type="service-ad" data-id="${escapeHtml(a.id)}" aria-label="Edit ad"><i data-lucide="pencil"></i>Edit</button>
        <p class="promo-ad-eyebrow">${escapeHtml(a.eyebrow)}</p>
        <p class="promo-ad-title">${escapeHtml(a.title)}</p>
      </div>
    `).join('') + `
      <div class="service-card add-card-tile" data-type="service" id="addServiceTile" style="min-height:220px;">
        <i data-lucide="plus"></i><span>Add Service</span>
      </div>
      <div class="service-card add-card-tile ad-tile" data-type="service-ad" id="addServiceAdTile" style="min-height:220px;">
        <i data-lucide="megaphone"></i><span>Add Ad</span>
      </div>`;
    refreshIcons();
    try{ if(typeof initTilt === 'function') initTilt('.service-card', { maxTilt: 8 }); }catch(err){ /* tilt not ready yet */ }
    try{ if(typeof applyReveal === 'function') applyReveal(grid.querySelectorAll('.service-card')); }catch(err){ /* reveal module not ready yet */ }
  }

  // ---------- Shared Quick Edit modal ----------
  const qeOverlay = document.getElementById('quickEditOverlay');
  const qeForm = document.getElementById('quickEditForm');
  const qeFields = document.getElementById('quickEditFields');
  const qeTitle = document.getElementById('quickEditTitle');
  const qeSub = document.getElementById('quickEditSub');
  const qeDeleteBtn = document.getElementById('quickEditDelete');
  let qeContext = null; // { type: 'team'|'service', id: string|null }

  function adListFor(type){
    if(type === 'about-ad') return { list: aboutAds, key: ABOUT_ADS_KEY, set: (v) => aboutAds = v };
    if(type === 'team-ad') return { list: teamAds, key: TEAM_ADS_KEY, set: (v) => teamAds = v };
    return { list: serviceAds, key: SERVICE_ADS_KEY, set: (v) => serviceAds = v };
  }

  function openQuickEdit(type, id){
    qeContext = { type, id };
    const isNew = !id;
    if(type === 'team'){
      const t = isNew ? { name:'', role:'', photo:'' } : teamMembers.find(x => x.id === id) || { name:'', role:'', photo:'' };
      qeTitle.textContent = isNew ? 'Add Crew Member' : 'Edit Crew Member';
      qeSub.textContent = 'Shown in The Crew section.';
      qeFields.innerHTML = `
        <div class="field"><label for="qeName">Name</label><input id="qeName" type="text" value="${escapeHtml(t.name)}" required></div>
        <div class="field"><label for="qeRole">Role</label><input id="qeRole" type="text" value="${escapeHtml(t.role)}" required></div>
        <div class="field">
          <label for="qeTeamPhoto">Photo</label>
          <div class="image-input-row">
            <input id="qeTeamPhoto" type="text" value="${escapeHtml(t.photo || '')}" placeholder="Paste an image URL, or upload from your PC">
            <label class="btn btn-outline file-upload-btn" for="qeTeamPhotoFile"><i data-lucide="upload"></i>Upload from PC</label>
            <input id="qeTeamPhotoFile" type="file" accept="image/*" hidden>
          </div>
          <div class="image-preview" id="qeTeamPhotoPreview"><span>No photo yet</span></div>
        </div>`;
      setTimeout(() => { wireImageField('qeTeamPhoto', 'qeTeamPhotoFile', 'qeTeamPhotoPreview'); refreshIcons(); }, 0);
    } else if(type === 'service'){
      const s = isNew ? { title:'', desc:'', icon:'sparkles', image:'' } : services.find(x => x.id === id) || { title:'', desc:'', icon:'sparkles', image:'' };
      qeTitle.textContent = isNew ? 'Add Offering' : 'Edit Offering';
      qeSub.textContent = 'Shown in the What We Do (Offerings) section.';
      qeFields.innerHTML = `
        <div class="field"><label for="qeTitleInput">Title</label><input id="qeTitleInput" type="text" value="${escapeHtml(s.title)}" required></div>
        <div class="field"><label for="qeDesc">Description</label><input id="qeDesc" type="text" value="${escapeHtml(s.desc)}" required></div>
        <div class="field"><label for="qeIcon">Icon name (lucide)</label><input id="qeIcon" type="text" value="${escapeHtml(s.icon || 'sparkles')}" placeholder="e.g. sparkles, layers, zap"></div>
        <div class="field">
          <label for="qeServiceImage">Picture (optional)</label>
          <div class="image-input-row">
            <input id="qeServiceImage" type="text" value="${escapeHtml(s.image || '')}" placeholder="https://... or upload from your PC — leave blank to use the icon style">
            <label class="btn btn-outline file-upload-btn" for="qeServiceImageFile"><i data-lucide="upload"></i>Upload from PC</label>
            <input id="qeServiceImageFile" type="file" accept="image/*" hidden>
          </div>
          <div class="image-preview" id="qeServiceImagePreview"><span>No picture yet</span></div>
        </div>`;
      setTimeout(() => { wireImageField('qeServiceImage', 'qeServiceImageFile', 'qeServiceImagePreview'); refreshIcons(); }, 0);
    } else {
      // about-ad / team-ad / service-ad — all share the same {eyebrow, title, image} shape
      const { list } = adListFor(type);
      const a = isNew ? { eyebrow:'', title:'', image:'' } : list.find(x => x.id === id) || { eyebrow:'', title:'', image:'' };
      const label = type === 'about-ad' ? 'the About' : type === 'team-ad' ? 'The Crew' : 'What We Do';
      qeTitle.textContent = isNew ? 'Add Ad' : 'Edit Ad';
      qeSub.textContent = `Shown in ${label} section.`;
      qeFields.innerHTML = `
        <div class="field"><label for="qeAdEyebrow">Small label</label><input id="qeAdEyebrow" type="text" value="${escapeHtml(a.eyebrow)}" placeholder="e.g. Limited Offer" required></div>
        <div class="field"><label for="qeAdTitle">Headline</label><input id="qeAdTitle" type="text" value="${escapeHtml(a.title)}" placeholder="e.g. 20% Off Fragrance" required></div>
        <div class="field">
          <label for="qeAdImage">Picture</label>
          <div class="image-input-row">
            <input id="qeAdImage" type="text" value="${escapeHtml(a.image)}" placeholder="https://... or upload from your PC" required>
            <label class="btn btn-outline file-upload-btn" for="qeAdImageFile"><i data-lucide="upload"></i>Upload from PC</label>
            <input id="qeAdImageFile" type="file" accept="image/*" hidden>
          </div>
          <div class="image-preview" id="qeAdImagePreview"><span>No picture yet</span></div>
        </div>`;
      setTimeout(() => { wireImageField('qeAdImage', 'qeAdImageFile', 'qeAdImagePreview'); refreshIcons(); }, 0);
    }
    qeDeleteBtn.style.display = isNew ? 'none' : 'inline-flex';
    if(qeOverlay) qeOverlay.classList.add('open');
  }

  window.openTeamEdit = (id) => openQuickEdit('team', id || null);
  window.openServiceEdit = (id) => openQuickEdit('service', id || null);

  if(qeForm){
    qeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if(!qeContext) return;
      const { type, id } = qeContext;
      if(type === 'team'){
        const name = document.getElementById('qeName').value.trim();
        const role = document.getElementById('qeRole').value.trim();
        const _qeTeamPhotoEl = document.getElementById('qeTeamPhoto');
        const photo = (_qeTeamPhotoEl ? (_qeTeamPhotoEl.value || '') : '').trim();
        if(!name || !role) return;
        if(id){ teamMembers = teamMembers.map(t => t.id === id ? { ...t, name, role, photo } : t); }
        else{ teamMembers = [...teamMembers, { id: 't' + Date.now(), name, role, photo }]; }
        saveList(TEAM_KEY, teamMembers);
        renderTeam();
        try{ if(typeof renderAdminCrewList === 'function') renderAdminCrewList(); }catch(err){ /* admin panel not open */ }
      } else if(type === 'service'){
        const title = document.getElementById('qeTitleInput').value.trim();
        const desc = document.getElementById('qeDesc').value.trim();
        const icon = document.getElementById('qeIcon').value.trim() || 'sparkles';
        const _qeServiceImageEl = document.getElementById('qeServiceImage');
        const image = (_qeServiceImageEl ? (_qeServiceImageEl.value || '') : '').trim();
        if(!title || !desc) return;
        if(id){ services = services.map(s => s.id === id ? { ...s, title, desc, icon, image } : s); }
        else{ services = [...services, { id: 's' + Date.now(), title, desc, icon, image }]; }
        saveList(SERVICES_KEY, services);
        renderServices();
        try{ if(typeof renderAdminOfferingsList === 'function') renderAdminOfferingsList(); }catch(err){ /* admin panel not open */ }
      } else {
        const eyebrow = document.getElementById('qeAdEyebrow').value.trim();
        const adTitle = document.getElementById('qeAdTitle').value.trim();
        const image = document.getElementById('qeAdImage').value.trim();
        if(!eyebrow || !adTitle || !image) return;
        const { list, key, set } = adListFor(type);
        let next;
        if(id){ next = list.map(a => a.id === id ? { ...a, eyebrow, title: adTitle, image } : a); }
        else{ next = [...list, { id: 'ad' + Date.now(), eyebrow, title: adTitle, image }]; }
        set(next);
        saveList(key, next);
        if(type === 'about-ad'){ if(typeof window.renderAboutAds === 'function') window.renderAboutAds(); }
        else if(type === 'team-ad'){ renderTeam(); }
        else{ renderServices(); }
        try{ if(typeof renderAdminAdsList === 'function') renderAdminAdsList(); }catch(err){ /* admin panel not open */ }
      }
      qeOverlay.classList.remove('open');
      try{ playSound('add'); }catch(err){ /* sound module unavailable */ }
      refreshIcons();
    });
  }

  if(qeDeleteBtn){
    qeDeleteBtn.addEventListener('click', () => {
      if(!qeContext || !qeContext.id) return;
      const { type, id } = qeContext;
      if(!window.confirm('Remove this from the site?')) return;
      if(type === 'team'){
        teamMembers = teamMembers.filter(t => t.id !== id); saveList(TEAM_KEY, teamMembers); renderTeam();
        try{ if(typeof renderAdminCrewList === 'function') renderAdminCrewList(); }catch(err){ /* admin panel not open */ }
      }
      else if(type === 'service'){
        services = services.filter(s => s.id !== id); saveList(SERVICES_KEY, services); renderServices();
        try{ if(typeof renderAdminOfferingsList === 'function') renderAdminOfferingsList(); }catch(err){ /* admin panel not open */ }
      }
      else{
        const { list, key, set } = adListFor(type);
        const next = list.filter(a => a.id !== id);
        set(next);
        saveList(key, next);
        if(type === 'about-ad'){ if(typeof window.renderAboutAds === 'function') window.renderAboutAds(); }
        else if(type === 'team-ad'){ renderTeam(); }
        else{ renderServices(); }
        try{ if(typeof renderAdminAdsList === 'function') renderAdminAdsList(); }catch(err){ /* admin panel not open */ }
      }
      qeOverlay.classList.remove('open');
      try{ playSound('click'); }catch(err){ /* sound module unavailable */ }
      refreshIcons();
    });
  }

  const qeClose = document.getElementById('quickEditClose');
  if(qeClose) qeClose.addEventListener('click', () => qeOverlay.classList.remove('open'));
  if(qeOverlay){
    qeOverlay.addEventListener('click', (e) => { if(e.target.id === 'quickEditOverlay') qeOverlay.classList.remove('open'); });
  }

  // Delegated clicks for edit-pencil buttons and "add" tiles on both grids.
  ['teamGrid','servicesGrid'].forEach(gridId => {
    const grid = document.getElementById(gridId);
    if(!grid) return;
    grid.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.content-edit-btn');
      const addTile = e.target.closest('.add-card-tile');
      if(editBtn && isAdmin){ openQuickEdit(editBtn.dataset.type, editBtn.dataset.id); }
      else if(addTile && isAdmin){ openQuickEdit(addTile.dataset.type, null); }
    });
  });

  const adminHeroForm = document.getElementById('adminHeroForm');
  if(adminHeroForm){
    adminHeroForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const image = document.getElementById('ahImage').value.trim();
      if(!image) return;
      try{ localStorage.setItem(HERO_IMAGE_KEY, image); }catch(err){ console.warn('Could not save hero image', err); }
      applyHeroImage();
      try{ playSound('add'); }catch(err){ /* sound module unavailable */ }
      try{ showAdminToast('Hero photo updated.'); }catch(err){ /* toast unavailable */ }
    });
  }

  // "Edit" button on the About section — admin-only, edits the ad slide
  // currently showing in the carousel (or opens the Add Ad form if empty).
  const aboutEditBtn = document.getElementById('aboutEditBtn');
  if(aboutEditBtn){
    aboutEditBtn.addEventListener('click', () => {
      if(!isAdmin) return;
      const state = window.__aboutAdsState;
      if(state && state.list.length){
        openQuickEdit('about-ad', state.list[state.index].id);
      } else {
        openQuickEdit('about-ad', null);
      }
    });
  }

  // ---------- Admin-panel-side lists (Offerings / Crew / Ads tabs) ----------
  // These render the same underlying arrays as the storefront, but as
  // manageable rows inside the Admin Control Panel, each wired to the
  // shared Quick Edit modal above.
  function renderAdminOfferingsList(){
    const list = document.getElementById('adminOfferingsList');
    const countEl = document.getElementById('adminOfferingsCount');
    if(!list) return;
    if(countEl) countEl.textContent = services.length;
    if(!services.length){
      list.innerHTML = '<p class="admin-empty-note">No offerings yet — add your first one above.</p>';
    } else {
      list.innerHTML = services.map(s => `
        <div class="admin-content-row">
          <div class="admin-content-thumb">${s.image ? `<img src="${escapeHtml(s.image)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none';">` : `<i data-lucide="${escapeHtml(s.icon || 'layers')}"></i>`}</div>
          <div class="admin-content-info"><h4>${escapeHtml(s.title)}</h4><p>${escapeHtml(s.desc)}</p></div>
          <div class="admin-content-actions">
            <button type="button" class="admin-labeled-btn" data-admin-edit="service" data-id="${escapeHtml(s.id)}"><i data-lucide="pencil"></i>Edit</button>
            <button type="button" class="admin-labeled-btn danger" data-admin-remove="service" data-id="${escapeHtml(s.id)}"><i data-lucide="archive"></i>Remove</button>
          </div>
        </div>`).join('');
    }
    refreshIcons();
  }

  function renderAdminCrewList(){
    const list = document.getElementById('adminCrewList');
    const countEl = document.getElementById('adminCrewCount');
    if(!list) return;
    if(countEl) countEl.textContent = teamMembers.length;
    if(!teamMembers.length){
      list.innerHTML = '<p class="admin-empty-note">No crew members yet — add your first one above.</p>';
    } else {
      list.innerHTML = teamMembers.map(t => `
        <div class="admin-content-row">
          <div class="admin-content-thumb"><i data-lucide="user"></i></div>
          <div class="admin-content-info"><h4>${escapeHtml(t.name)}</h4><p>${escapeHtml(t.role)}</p></div>
          <div class="admin-content-actions">
            <button type="button" class="admin-labeled-btn" data-admin-edit="team" data-id="${escapeHtml(t.id)}"><i data-lucide="pencil"></i>Edit</button>
            <button type="button" class="admin-labeled-btn danger" data-admin-remove="team" data-id="${escapeHtml(t.id)}"><i data-lucide="archive"></i>Remove</button>
          </div>
        </div>`).join('');
    }
    refreshIcons();
  }

  function renderAdminAdsList(){
    const list = document.getElementById('adminAdsList');
    const countEl = document.getElementById('adminAdsCount');
    const all = [
      ...aboutAds.map(a => ({ ...a, kind:'about-ad', label:'About' })),
      ...teamAds.map(a => ({ ...a, kind:'team-ad', label:'Crew' })),
      ...serviceAds.map(a => ({ ...a, kind:'service-ad', label:'Offerings' }))
    ];
    if(!list) return;
    if(countEl) countEl.textContent = all.length;
    if(!all.length){
      list.innerHTML = '<p class="admin-empty-note">No promo ads yet — add one above for About, Crew or Offerings.</p>';
    } else {
      list.innerHTML = all.map(a => `
        <div class="admin-content-row">
          <div class="admin-content-thumb">${a.image ? `<img src="${escapeHtml(a.image)}" alt="" loading="lazy" decoding="async" onerror="this.style.display='none';">` : `<i data-lucide="megaphone"></i>`}</div>
          <div class="admin-content-info"><h4>${escapeHtml(a.title)}</h4><p>${escapeHtml(a.label)} section · ${escapeHtml(a.eyebrow)}</p></div>
          <div class="admin-content-actions">
            <button type="button" class="admin-labeled-btn" data-admin-edit="${escapeHtml(a.kind)}" data-id="${escapeHtml(a.id)}"><i data-lucide="pencil"></i>Edit</button>
            <button type="button" class="admin-labeled-btn danger" data-admin-remove="${escapeHtml(a.kind)}" data-id="${escapeHtml(a.id)}"><i data-lucide="archive"></i>Remove</button>
          </div>
        </div>`).join('');
    }
    refreshIcons();
  }

  // Delegated clicks for the three admin-panel content tabs — routes
  // straight into the same openQuickEdit() modal used on-page, and into
  // the same delete confirmation used everywhere else.
  const adminContentTabsEl = document.getElementById('adminOverlay');
  if(adminContentTabsEl){
    adminContentTabsEl.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-admin-edit]');
      const removeBtn = e.target.closest('[data-admin-remove]');
      const addBtn = e.target.closest('[data-admin-add]');
      if(editBtn){ openQuickEdit(editBtn.dataset.adminEdit, editBtn.dataset.id); }
      else if(addBtn){ openQuickEdit(addBtn.dataset.adminAdd, null); }
      else if(removeBtn){
        const type = removeBtn.dataset.adminRemove, id = removeBtn.dataset.id;
        if(!window.confirm('Remove this from the site?')) return;
        if(type === 'team'){ teamMembers = teamMembers.filter(t => t.id !== id); saveList(TEAM_KEY, teamMembers); renderTeam(); renderAdminCrewList(); }
        else if(type === 'service'){ services = services.filter(s => s.id !== id); saveList(SERVICES_KEY, services); renderServices(); renderAdminOfferingsList(); }
        else{
          const { list: l, key, set } = adListFor(type);
          const next = l.filter(a => a.id !== id);
          set(next); saveList(key, next);
          if(type === 'about-ad'){ if(typeof window.renderAboutAds === 'function') window.renderAboutAds(); }
          else if(type === 'team-ad'){ renderTeam(); }
          else{ renderServices(); }
          renderAdminAdsList();
        }
        try{ playSound('click'); }catch(err){ /* sound module unavailable */ }
        refreshIcons();
      }
    });
  }

  window.__content = {
    renderTeam, renderServices,
    renderAdminOfferingsList, renderAdminCrewList, renderAdminAdsList
  };

  }catch(err){ console.warn('Team/Services content module setup failed', err); }

  try{

  function findCartItem(name){ return cart.find(i => i.name === name); }

  // Computes the current discount amount (in dollars) for a given subtotal,
  // clamped so a coupon can never take the order below $0.
  function getDiscountAmount(subtotal){
    if(!appliedDiscount) return 0;
    const raw = appliedDiscount.type === 'percent'
      ? subtotal * (appliedDiscount.value / 100)
      : appliedDiscount.value;
    return Math.min(subtotal, raw);
  }

  // Returns the final payable total (subtotal minus any applied discount).
  function getCartTotal(){
    const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
    return Math.max(0, subtotal - getDiscountAmount(subtotal));
  }

  function renderCart(){
    const summary = document.getElementById('cartSummary');
    const cartCount = document.getElementById('cartCount');
    const discountBlock = document.getElementById('discountBlock');
    cartCount.textContent = cart.reduce((sum, i) => sum + i.qty, 0);
    if(cart.length === 0){
      summary.innerHTML = '<p style="font-size:0.85rem;color:var(--muted-foreground);">Your bag is empty. Add pieces from the shop.</p>';
      if(discountBlock) discountBlock.style.display = 'none';
      renderCartUpsell();
      return;
    }
    let subtotal = 0;
    let rows = '';
    cart.forEach(item => {
      subtotal += item.price * item.qty;
      rows += `<div class="cart-line">
        <div class="cart-line-info">
          <span class="cart-line-name">${item.name}</span>
          <span class="cart-line-price">${formatPrice(item.price)} each</span>
        </div>
        <div class="cart-line-controls">
          <button class="qty-btn" data-action="dec" data-name="${item.name}" aria-label="Decrease quantity">−</button>
          <span class="qty-value">${item.qty}</span>
          <button class="qty-btn" data-action="inc" data-name="${item.name}" aria-label="Increase quantity">+</button>
          <button class="remove-btn" data-name="${item.name}" aria-label="Remove ${item.name}"><i data-lucide="trash-2"></i></button>
          <button type="button" class="qty-pay-now" data-action="goto-pay">Pay Now</button>
        </div>
      </div>`;
    });
    const discountAmount = getDiscountAmount(subtotal);
    if(appliedDiscount && discountAmount > 0){
      rows += `<div class="cart-line discount-line"><span>Discount (${appliedDiscount.code})</span><span>−${formatPrice(discountAmount, true)}</span></div>`;
    }
    const finalTotal = Math.max(0, subtotal - discountAmount);
    rows += `<div class="cart-line total"><span>Total</span><span>${formatPrice(finalTotal, true)}</span></div>`;
    summary.innerHTML = rows;
    if(discountBlock) discountBlock.style.display = 'block';
    renderDiscountUI();
    renderCartUpsell();
    refreshIcons();
  }

  // Shows either the "enter a code" input or, once a code is applied, a
  // chip confirming which code is active with a way to remove it.
  function renderDiscountUI(){
    const inputRow = document.getElementById('discountInputRow');
    const appliedWrap = document.getElementById('discountAppliedWrap');
    if(!inputRow || !appliedWrap) return;
    if(appliedDiscount){
      inputRow.style.display = 'none';
      appliedWrap.innerHTML = `<div class="discount-applied-chip">
        <span><strong>${appliedDiscount.code}</strong> applied — ${appliedDiscount.label}</span>
        <button type="button" class="discount-remove-btn" id="removeDiscountBtn">Remove</button>
      </div>`;
      const removeBtn = document.getElementById('removeDiscountBtn');
      if(removeBtn) removeBtn.addEventListener('click', removeDiscountCode);
    } else{
      inputRow.style.display = 'flex';
      appliedWrap.innerHTML = '';
    }
  }

  function showDiscountMsg(text, isError){
    const msg = document.getElementById('discountMsg');
    if(!msg) return;
    msg.textContent = text;
    msg.classList.remove('success','error');
    msg.classList.add(isError ? 'error' : 'success', 'show');
    setTimeout(() => msg.classList.remove('show'), 3200);
  }

  function applyDiscountCode(){
    const input = document.getElementById('discountInput');
    if(!input) return;
    const code = input.value.trim().toUpperCase();
    if(!code){ showDiscountMsg('Enter a code first.', true); return; }
    const match = discountCodes.find(d => d.code === code);
    if(!match){ showDiscountMsg('That code isn\'t valid.', true); return; }
    appliedDiscount = { ...match };
    input.value = '';
    renderCart();
    showDiscountMsg(`"${code}" applied — ${match.label}.`, false);
    try{ playSound('add'); }catch(err){ /* sound module unavailable */ }
  }

  function removeDiscountCode(){
    appliedDiscount = null;
    renderCart();
  }

  // ------------------------------------------------------------
  // RELATED PRODUCTS ("You Might Also Like") shown in the cart —
  // simple upsell: pick a few in-stock pieces that aren't already
  // in the bag, favoring categories the shopper hasn't bought yet.
  // ------------------------------------------------------------
  function renderCartUpsell(){
    const upsellBlock = document.getElementById('cartUpsell');
    const grid = document.getElementById('cartUpsellGrid');
    if(!upsellBlock || !grid) return;
    if(cart.length === 0 || !window.__products || typeof window.__products.get !== 'function'){
      upsellBlock.style.display = 'none';
      grid.innerHTML = '';
      return;
    }
    const allProducts = window.__products.get();
    const cartNames = new Set(cart.map(i => i.name));
    const cartCategories = new Set();
    allProducts.forEach(p => { if(cartNames.has(p.name)) cartCategories.add(p.category); });
    const candidates = allProducts.filter(p => !cartNames.has(p.name) && Number(p.stock) > 0);
    // Prefer pieces from a different category than what's already in the
    // bag (cross-sell), falling back to any other in-stock piece.
    const preferred = candidates.filter(p => !cartCategories.has(p.category));
    const pool = (preferred.length >= 3 ? preferred : candidates).slice();
    // Simple shuffle so the suggestions don't feel static every time.
    for(let i = pool.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picks = pool.slice(0, 3);
    if(picks.length === 0){
      upsellBlock.style.display = 'none';
      grid.innerHTML = '';
      return;
    }
    upsellBlock.style.display = 'block';
    grid.innerHTML = picks.map(p => {
      const img = p.image && p.image.trim() ? p.image : 'https://images.unsplash.com/photo-1541643600914-78b084683601?w=600&h=750&fit=crop';
      return `<div class="upsell-card">
        <div class="upsell-photo"><img src="${img}" alt="${p.name}" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='https://images.unsplash.com/photo-1541643600914-78b084683601?w=600&h=750&fit=crop';"></div>
        <div class="upsell-body">
          <p class="upsell-name">${p.name}</p>
          <p class="upsell-price">${formatPrice(p.price)}</p>
          <button type="button" class="upsell-add-btn" data-name="${p.name}" data-price="${p.price}">Add</button>
        </div>
      </div>`;
    }).join('');
  }

  // NOTE: "Add to Cart" clicks are handled by a single delegated listener on
  // #productGrid (see the Products module) because product cards are now
  // rendered dynamically and can change at any time (admin add/edit/delete).
  window.addToCart = function(name, price, btn){
    const existing = findCartItem(name);
    if(existing){ existing.qty += 1; }
    else{ cart.push({ name, price: Number(price), qty: 1 }); }
    renderCart();
    try{ playSound('add'); }catch(err){ /* sound module unavailable */ }
    if(btn){
      const original = btn.textContent;
      btn.textContent = 'Added';
      setTimeout(() => btn.textContent = original, 1000);
    }
  };

  // Delegated clicks inside the cart summary (quantity +/-, remove)
  document.getElementById('cartSummary').addEventListener('click', (e) => {
    const qtyBtn = e.target.closest('.qty-btn');
    const removeBtn = e.target.closest('.remove-btn');
    const payNowHint = e.target.closest('.qty-pay-now');
    if(qtyBtn){
      const item = findCartItem(qtyBtn.dataset.name);
      if(!item) return;
      if(qtyBtn.dataset.action === 'inc'){ item.qty += 1; }
      else{ item.qty -= 1; if(item.qty <= 0){ cart = cart.filter(i => i.name !== item.name); } }
      renderCart();
    } else if(removeBtn){
      cart = cart.filter(i => i.name !== removeBtn.dataset.name);
      renderCart();
    } else if(payNowHint){
      // Jumps straight to the Pay Now button at the bottom of the same
      // checkout modal, so shoppers can go from "+" to paying in one tap.
      const payBtn = document.getElementById('payBtn');
      if(payBtn){
        payBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        payBtn.classList.add('animate-fade-in');
        setTimeout(() => payBtn.focus(), 400);
      }
    }
  });

  const applyDiscountBtn = document.getElementById('applyDiscountBtn');
  const discountInputEl = document.getElementById('discountInput');
  if(applyDiscountBtn) applyDiscountBtn.addEventListener('click', applyDiscountCode);
  if(discountInputEl){
    discountInputEl.addEventListener('keydown', (e) => {
      if(e.key === 'Enter'){ e.preventDefault(); applyDiscountCode(); }
    });
  }

  const cartUpsellGridEl = document.getElementById('cartUpsellGrid');
  if(cartUpsellGridEl){
    cartUpsellGridEl.addEventListener('click', (e) => {
      const addBtn = e.target.closest('.upsell-add-btn');
      if(!addBtn || typeof window.addToCart !== 'function') return;
      // renderCart() re-renders this grid immediately (the item drops out of
      // "You Might Also Like" since it's now in the bag), so that swap is
      // the add-confirmation — no separate button state needed.
      window.addToCart(addBtn.dataset.name, addBtn.dataset.price, null);
    });
  }

  function openModal(id){ document.getElementById(id).classList.add('open'); }
  function closeModal(id){ document.getElementById(id).classList.remove('open'); }

  // "Order Now" (lightning bolt) button on a product card: adds the item
  // straight to the cart and jumps directly into checkout.
  window.orderNow = function(name, price){
    if(typeof window.addToCart === 'function') window.addToCart(name, price, null);
    renderCart();
    openModal('cartOverlay');
    try{ playSound('swoosh'); }catch(err){ /* sound module unavailable */ }
  };

  // Payment method tabs (Card / JazzCash / Bank) inside the checkout modal.
  // Only the visible method's fields stay `required` so hidden fields never
  // block form submission.
  document.querySelectorAll('.pay-method-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const method = tab.dataset.method;
      document.querySelectorAll('.pay-method-tab').forEach(t => t.classList.toggle('active', t === tab));
      document.querySelectorAll('.pay-fields').forEach(f => {
        const isActive = f.dataset.methodFields === method;
        f.classList.toggle('active', isActive);
        f.querySelectorAll('input').forEach(inp => {
          if(f.dataset.methodFields === 'card'){ inp.required = isActive; }
        });
      });
      try{ playSound('click'); }catch(err){ /* sound module unavailable */ }
    });
  });

  // Prefills the shipping email field with whichever email the buyer
  // last used (sign-in or a previous order), so returning buyers don't
  // have to retype it every time they check out.
  function prefillShipEmail(){
    const shipEmailInput = document.getElementById('shipEmail');
    if(!shipEmailInput || shipEmailInput.value) return;
    try{
      const known = localStorage.getItem('genz_remembered_email') || localStorage.getItem('genz_last_order_email');
      if(known) shipEmailInput.value = known;
    }catch(err){ /* storage unavailable */ }
  }

  document.getElementById('loginBtn').addEventListener('click', () => {
    if(getCurrentUser()){
      clearCurrentUser();
      updateLoginButtonUI();
      try{ playSound('click'); }catch(err){ /* sound module unavailable */ }
      showScreen('welcome');
    } else {
      showScreen('login');
    }
  });
  document.getElementById('cartBtn').addEventListener('click', () => { renderCart(); openModal('cartOverlay'); prefillShipEmail(); });
  document.getElementById('paymentBtn').addEventListener('click', () => {
    renderCart();
    openModal('cartOverlay');
    prefillShipEmail();
    setTimeout(() => { const cn = document.getElementById('cardName'); if(cn) cn.focus(); }, 150);
  });
  document.getElementById('cartClose').addEventListener('click', () => closeModal('cartOverlay'));

  document.getElementById('cartOverlay').addEventListener('click', (e) => {
    if(e.target.id === 'cartOverlay') closeModal('cartOverlay');
  });

  document.querySelectorAll('.tab-btn').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab + 'Panel').classList.add('active');
    });
  });

  }catch(err){ console.warn('Cart/tab setup failed', err); }

  try{

  // ---------- Wishlist ----------
  function renderWishlist(){
    const summary = document.getElementById('wishlistSummary');
    const count = document.getElementById('wishlistCount');
    count.textContent = wishlist.length;
    if(wishlist.length === 0){
      summary.innerHTML = '<p style="font-size:0.85rem;color:var(--muted-foreground);">Nothing saved yet. Tap the heart on any piece.</p>';
      return;
    }
    summary.innerHTML = wishlist.map(item => `
      <div class="cart-line">
        <div class="cart-line-info">
          <span class="cart-line-name">${item.name}</span>
          <span class="cart-line-price">${formatPrice(item.price)}</span>
        </div>
        <div class="cart-line-controls">
          <button class="wish-move-btn" data-name="${item.name}" data-price="${item.price}">Move to Cart</button>
          <button class="remove-btn" data-name="${item.name}" aria-label="Remove ${item.name} from wishlist"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
    `).join('');
    refreshIcons();
  }

  // NOTE: wishlist-heart clicks are handled by a delegated listener on
  // #productGrid (see the Products module) since cards render dynamically.
  window.toggleWishlist = function(name, price, btn){
    const idx = wishlist.findIndex(i => i.name === name);
    if(idx > -1){
      wishlist.splice(idx, 1);
      if(btn) btn.classList.remove('active');
    } else {
      wishlist.push({ name, price });
      if(btn) btn.classList.add('active');
    }
    renderWishlist();
  };

  document.getElementById('wishlistSummary').addEventListener('click', (e) => {
    const moveBtn = e.target.closest('.wish-move-btn');
    const removeBtn = e.target.closest('.remove-btn');
    if(moveBtn){
      const name = moveBtn.dataset.name;
      const price = Number(moveBtn.dataset.price);
      const existing = document.querySelector(`.add-cart-btn[data-name="${CSS.escape(name)}"]`);
      if(existing){ existing.click(); }
      wishlist = wishlist.filter(i => i.name !== name);
      document.querySelectorAll(`.wishlist-btn[data-name="${CSS.escape(name)}"]`).forEach(b => b.classList.remove('active'));
      renderWishlist();
    } else if(removeBtn){
      const name = removeBtn.dataset.name;
      wishlist = wishlist.filter(i => i.name !== name);
      document.querySelectorAll(`.wishlist-btn[data-name="${CSS.escape(name)}"]`).forEach(b => b.classList.remove('active'));
      renderWishlist();
    }
  });

  document.getElementById('wishlistBtn').addEventListener('click', () => { renderWishlist(); openModal('wishlistOverlay'); });
  document.getElementById('wishlistClose').addEventListener('click', () => closeModal('wishlistOverlay'));
  const sizeGuideCloseBtn = document.getElementById('sizeGuideClose');
  const sizeGuideOverlayEl = document.getElementById('sizeGuideOverlay');
  if(sizeGuideCloseBtn && sizeGuideOverlayEl){
    sizeGuideCloseBtn.addEventListener('click', () => closeModal('sizeGuideOverlay'));
    sizeGuideOverlayEl.addEventListener('click', (e) => { if(e.target.id === 'sizeGuideOverlay') closeModal('sizeGuideOverlay'); });
  }
  document.getElementById('wishlistOverlay').addEventListener('click', (e) => {
    if(e.target.id === 'wishlistOverlay') closeModal('wishlistOverlay');
  });

  }catch(err){ console.warn('Wishlist setup failed', err); }

  // ============================================================
  // TRACK ORDER MODAL
  // Buyer looks up orders by the email used at checkout. Each order
  // renders as a step tracker (Order Placed → Packed → Shipped →
  // Out for Delivery → Delivered), with the current stage computed
  // from elapsed time since the order was placed (see ORDER_STAGE_HOURS
  // above) since there's no real courier API behind this demo site.
  // ============================================================
  try{

  // Remembers the last-seen stage per order (in localStorage) so that if
  // an order has moved forward since the buyer last checked, we can show
  // a toast calling it out — a lightweight stand-in for a real "your order
  // has shipped" push/email notification.
  const SEEN_STAGE_KEY = 'genz_seen_order_stages_v1';
  function loadSeenStages(){
    try{ const raw = localStorage.getItem(SEEN_STAGE_KEY); return raw ? JSON.parse(raw) : {}; }
    catch(err){ return {}; }
  }
  function saveSeenStages(map){
    try{ localStorage.setItem(SEEN_STAGE_KEY, JSON.stringify(map)); }catch(err){ /* storage unavailable */ }
  }
  function notifyStageChanges(orders){
    const seen = loadSeenStages();
    let changed = false;
    orders.forEach(order => {
      const stageIndex = getOrderStageIndex(order);
      const prev = seen[order.orderNumber];
      if(prev !== undefined && stageIndex > prev){
        const label = ORDER_STEPS[stageIndex].label;
        try{ if(typeof showAdminToast === 'function') showAdminToast(`📦 Order #${order.orderNumber} update: ${label}`); }
        catch(err){ /* toast unavailable */ }
      }
      if(prev !== stageIndex){ seen[order.orderNumber] = stageIndex; changed = true; }
    });
    if(changed) saveSeenStages(seen);
  }

  function renderTrackResults(email){
    const results = document.getElementById('trackResults');
    const orders = loadOrders().filter(o => o.buyerEmail === email.trim().toLowerCase());
    if(orders.length === 0){
      results.innerHTML = `<p style="font-size:0.85rem;color:var(--muted-foreground);">No orders found for that email yet. Once you check out, they'll show up here.</p>`;
      return;
    }
    notifyStageChanges(orders);
    results.innerHTML = orders.map(order => {
      const stageIndex = getOrderStageIndex(order);
      const fillPct = (stageIndex / (ORDER_STEPS.length - 1)) * 88; // matches track-steps::before inset
      const itemsText = order.items.map(i => `${i.name} ×${i.qty}`).join(', ');
      const placedDate = new Date(order.date).toLocaleString();
      const steps = ORDER_STEPS.map((step, i) => {
        const cls = i < stageIndex ? 'done' : (i === stageIndex ? 'current' : '');
        return `<div class="track-step ${cls}">
          <div class="track-step-dot"><i data-lucide="${step.icon}"></i></div>
          <span class="track-step-label">${step.label}</span>
        </div>`;
      }).join('');
      return `<div class="track-order-card">
        <div class="track-order-head">
          <span class="order-number">#${order.orderNumber}</span>
          <span class="track-order-date">Placed ${placedDate}</span>
        </div>
        <p class="track-order-items">${itemsText} — Total ${formatPrice(order.total, true)}</p>
        <div class="track-steps">
          <div class="track-steps-fill" style="width:${fillPct}%;"></div>
          ${steps}
        </div>
        <p class="track-order-address"><i data-lucide="map-pin" style="width:12px;height:12px;vertical-align:-1px;margin-right:4px;"></i>${order.shipping.name} · ${order.shipping.address}, ${order.shipping.city}${order.shipping.postal ? ' ' + order.shipping.postal : ''} · ${order.shipping.phone}</p>
      </div>`;
    }).join('');
    refreshIcons();
  }

  const trackOrderBtn = document.getElementById('trackOrderBtn');
  const trackClose = document.getElementById('trackClose');
  const trackLookupForm = document.getElementById('trackLookupForm');
  const trackEmailInput = document.getElementById('trackEmailInput');

  if(trackOrderBtn){
    trackOrderBtn.addEventListener('click', () => {
      openModal('trackOverlay');
      // Prefill with the email from the buyer's last order (or their
      // remembered sign-in email) so returning buyers don't retype it.
      let lastEmail = '';
      try{ lastEmail = localStorage.getItem('genz_last_order_email') || localStorage.getItem('genz_remembered_email') || ''; }
      catch(err){ /* storage unavailable */ }
      if(lastEmail && trackEmailInput && !trackEmailInput.value){
        trackEmailInput.value = lastEmail;
        renderTrackResults(lastEmail);
      }
    });
  }
  if(trackClose) trackClose.addEventListener('click', () => closeModal('trackOverlay'));
  const trackOverlayEl = document.getElementById('trackOverlay');
  if(trackOverlayEl){
    trackOverlayEl.addEventListener('click', (e) => { if(e.target.id === 'trackOverlay') closeModal('trackOverlay'); });
  }
  if(trackLookupForm){
    trackLookupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      renderTrackResults(trackEmailInput.value);
    });
  }

  }catch(err){ console.warn('Track order setup failed', err); }

  try{

  // ---------- Shop search + category filter ----------
  const searchInput = document.getElementById('productSearch');
  const filterPills = document.querySelectorAll('.filter-pill');
  const shopCount = document.getElementById('shopCount');
  let activeCategory = 'all';

  function applyShopFilters(){
    // Re-query the empty-state element every call rather than caching it —
    // the product grid's innerHTML is fully replaced on every admin add/
    // edit/delete, so a cached reference would go stale.
    const shopEmptyState = document.getElementById('shopEmptyState');
    const query = searchInput.value.trim().toLowerCase();
    let visible = 0;
    document.querySelectorAll('.product-card').forEach(card => {
      const name = card.querySelector('.product-name').textContent.toLowerCase();
      const category = card.dataset.category;
      const matchesCategory = activeCategory === 'all' || category === activeCategory;
      const matchesSearch = !query || name.includes(query) || category.toLowerCase().includes(query);
      const show = matchesCategory && matchesSearch;
      card.style.display = show ? '' : 'none';
      if(show) visible += 1;
    });
    if(shopEmptyState) shopEmptyState.style.display = visible === 0 ? 'block' : 'none';
    if(shopCount) shopCount.textContent = `${visible} Piece${visible === 1 ? '' : 's'} / In Stock`;
  }

  searchInput.addEventListener('input', applyShopFilters);
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeCategory = pill.dataset.category;
      applyShopFilters();
    });
  });

  }catch(err){ console.warn('Shop filter setup failed', err); }


  try{

  // NOTE: This is a static front-end demo only. Even hashed, this credential
  // check happens entirely in the browser, so anyone who views source can see
  // the hash and target it — this is NOT real security. A real deployment
  // must verify admin login on a server/backend, never in client-side JS.
  // The password itself is no longer stored in plain text (see hashPassword
  // below) — only its SHA-256 hash lives in this file.
  const ADMIN_EMAIL = window.GENZ_ADMIN_EMAIL || 'admin@example.com';
  const ADMIN_PASSWORD_HASH = ''; // Admin password is verified only by the PHP backend.
  // Load the optional frontend PIN check from untracked deployment settings.
  // Backend verification remains required before granting an admin session.
  const ADMIN_PIN_HASH = window.GENZ_ADMIN_PIN_HASH || '';
  let pendingAdminMsgEl = null;

  function goToMain(msgEl, text){
    msgEl.textContent = text;
    msgEl.classList.remove('error');
    msgEl.classList.add('show');
    setTimeout(() => { showScreen('main'); msgEl.classList.remove('show'); }, 900);
  }

  function showFieldError(msgEl, text){
    msgEl.textContent = text;
    msgEl.classList.add('show','error');
  }

  // ============================================================
  // LOGIN DATABASE — every sign-in (buyer name or Google) is
  // logged here (name / email / password when available, provider,
  // timestamp) so the admin can see it under Admin Panel → Users.
  // Static front-end demo, so "database" = localStorage.
  // ============================================================
  const LOGIN_DB_KEY = 'genz_login_records_v1';
  function loadLoginRecords(){
    try{
      const raw = localStorage.getItem(LOGIN_DB_KEY);
      if(raw){ const parsed = JSON.parse(raw); if(Array.isArray(parsed)) return parsed; }
    }catch(err){ console.warn('Could not read login records', err); }
    return [];
  }
  function saveLoginRecords(list){
    try{ localStorage.setItem(LOGIN_DB_KEY, JSON.stringify(list)); }
    catch(err){ console.warn('Could not save login records', err); }
  }
  function recordLogin({ name, email, provider }){
    const records = loadLoginRecords();
    const entry = {
      name: name || '',
      email: email || '',
      provider: provider || 'Buyer',
      date: new Date().toLocaleString()
    };
    records.unshift(entry);
    saveLoginRecords(records);
    try{ if(typeof window.__renderAdminUsersList === 'function') window.__renderAdminUsersList(); }
    catch(err){ /* admin panel not open */ }
    // Server authentication routes record sign-ins centrally; this local copy
    // keeps the Users tab responsive while the remote list is loading.
  }
  window.__loadLoginRecords = loadLoginRecords;

  // Pulls every sign-in from the backend (all devices) and merges it with
  // whatever is stored locally, so the Admin Panel → Users tab shows a
  // complete picture. Falls back to local-only records if the backend
  // isn't reachable.
  async function syncLoginRecordsFromBackend(){
    try{
      const backendBase = (window.__genzBackend && window.__genzBackend.apiBase) || window.GENZ_API_BASE;
      if(!backendBase) return;
      const res = await fetch(backendBase + '/api/login-records', { cache:'no-store' });
      if(!res.ok) throw new Error('Could not fetch sign-ins from backend');
      const remoteRecords = await res.json();
      if(Array.isArray(remoteRecords)) saveLoginRecords(remoteRecords);
    }catch(err){
      console.warn('Backend not reachable — Users tab is showing local sign-ins only.', err);
    }
  }
  window.__syncLoginRecordsFromBackend = syncLoginRecordsFromBackend;

  // ============================================================
  // BUYER ACCOUNTS — InfinityFree PHP/MySQL version.
  // Passwords are hashed on the server; no buyer passwords are stored
  // in browser localStorage anymore.
  // ============================================================
  document.getElementById('buyerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rememberBox = document.getElementById('rememberMe');
    const buyerEmailInput = document.getElementById('buyerEmail');
    const buyerPasswordInput = document.getElementById('buyerPassword');
    const buyerMsg = document.getElementById('buyerMsg');
    const email = buyerEmailInput.value.trim().toLowerCase();
    const password = buyerPasswordInput.value;
    if(email === ADMIN_EMAIL.toLowerCase()){
      pendingAdminMsgEl = buyerMsg;
      const pinInput = document.getElementById('adminPinInput');
      const pinMsg = document.getElementById('adminPinMsg');
      if(pinInput) pinInput.value = '';
      if(pinMsg){ pinMsg.textContent = ''; pinMsg.classList.remove('show','error'); }
      openModal('adminPinOverlay');
      if(pinInput) setTimeout(() => pinInput.focus(), 150);
      return;
    }
    try{
      const res = await fetch(GENZ_API_BASE + '/api/auth/login', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email,password})
      });
      const data = await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error || 'Incorrect email or password.');
      if(!data || !data.user || !data.user.name || !data.user.email){
        throw new Error('Login server returned an invalid response. Please try again.');
      }
      if(rememberBox && rememberBox.checked) localStorage.setItem('genz_remembered_email', email);
      else localStorage.removeItem('genz_remembered_email');
      recordLogin({ name:data.user.name, email:data.user.email, provider:'Buyer' });
      setCurrentUser({ name:data.user.name, email:data.user.email });
      updateLoginButtonUI();
      goToMain(buyerMsg, `Welcome back, ${data.user.name} — taking you to GEN_Z…`);
    }catch(err){
      showFieldError(buyerMsg, err.message || 'Login failed. Try again.');
      buyerPasswordInput.focus();
    }
  });

  try{
    const rememberedEmail = localStorage.getItem('genz_remembered_email');
    if(rememberedEmail){
      const buyerEmailInput = document.getElementById('buyerEmail');
      const rememberBox = document.getElementById('rememberMe');
      if(buyerEmailInput) buyerEmailInput.value = rememberedEmail;
      if(rememberBox) rememberBox.checked = true;
    }
  }catch(err){}

  const forgotBtn = document.getElementById('forgotPasswordBtn');
  if(forgotBtn){
    forgotBtn.addEventListener('click', async () => {
      const buyerEmailInput = document.getElementById('buyerEmail');
      const buyerMsg = document.getElementById('buyerMsg');
      const email = buyerEmailInput ? buyerEmailInput.value.trim().toLowerCase() : '';
      if(!email || !email.includes('@')){
        showFieldError(buyerMsg, 'Enter your email above first, then tap "Forgot password?" again.');
        buyerEmailInput && buyerEmailInput.focus(); return;
      }
      try{
        const res=await fetch(GENZ_API_BASE+'/api/auth/forgot-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
        const data=await res.json().catch(()=>({}));
        buyerMsg.textContent=data.message || 'If that email exists, password-reset instructions are available.';
        buyerMsg.classList.remove('error'); buyerMsg.classList.add('show');
        setTimeout(()=>buyerMsg.classList.remove('show'),4500);
      }catch(err){ showFieldError(buyerMsg,'Password reset service is unavailable right now.'); }
    });
  }

  const goToSignupBtn = document.getElementById('goToSignupBtn');
  if(goToSignupBtn) goToSignupBtn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    const el=document.getElementById('signupPanel'); if(el) el.classList.add('active');
  });
  const goToSignInBtn = document.getElementById('goToSignInBtn');
  if(goToSignInBtn) goToSignInBtn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    const tab=document.querySelector('.tab-btn[data-tab="buyer"]'); if(tab) tab.classList.add('active');
    const panel=document.getElementById('buyerPanel'); if(panel) panel.classList.add('active');
  });

  const signupPasswordInput = document.getElementById('signupPassword');
  if(signupPasswordInput) signupPasswordInput.addEventListener('input', () => {
    const val=signupPasswordInput.value, fill=document.getElementById('signupPwStrengthFill'), label=document.getElementById('signupPwStrengthLabel');
    if(!fill||!label)return; let score=0;
    if(val.length>=6)score++; if(val.length>=10)score++; if(/[A-Z]/.test(val)&&/[a-z]/.test(val))score++; if(/\d/.test(val))score++; if(/[^A-Za-z0-9]/.test(val))score++;
    let text='',color='var(--border)',pct=0;
    if(val.length===0){} else if(score<=2){text='Weak';color='#c0392b';pct=33;} else if(score<=3){text='Medium';color='#C8A96A';pct=66;} else {text='Strong';color='#2e7d4f';pct=100;}
    fill.style.width=pct+'%'; fill.style.background=color; label.textContent=text; label.style.color=color;
  });

  const signupForm = document.getElementById('signupForm');
  if(signupForm) signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name=document.getElementById('signupName').value.trim();
    const email=document.getElementById('signupEmail').value.trim().toLowerCase();
    const password=document.getElementById('signupPassword').value;
    const confirmPassword=document.getElementById('signupConfirmPassword').value;
    const signupMsg=document.getElementById('signupMsg');
    if(!name||!email||!password||!confirmPassword){showFieldError(signupMsg,'Please fill in every field to create your account.');return;}
    if(password.length<6){showFieldError(signupMsg,'Password must be at least 6 characters.');return;}
    if(password!==confirmPassword){showFieldError(signupMsg,'Passwords do not match — please re-type them.');return;}
    try{
      const res=await fetch(GENZ_API_BASE+'/api/auth/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password})});
      const data=await res.json().catch(()=>({})); if(!res.ok) throw new Error(data.error||'Could not create account.');
      if(!data || !data.user || !data.user.name || !data.user.email){
        throw new Error('Signup server returned an invalid response. Please try again.');
      }
      recordLogin({name:data.user.name,email:data.user.email,provider:'Sign Up'});
      setCurrentUser({name:data.user.name,email:data.user.email}); updateLoginButtonUI();
      signupMsg.textContent=`Account created — welcome, ${name}!`; signupMsg.classList.remove('error'); signupMsg.classList.add('show');
      setTimeout(()=>{signupMsg.classList.remove('show');signupForm.reset();goToMain(document.getElementById('buyerMsg'),`Welcome, ${name} — taking you to GEN_Z…`);},1400);
    }catch(err){showFieldError(signupMsg,err.message||'Could not create account.');}
  });

  // ---------- REAL Google Sign-In ----------
  // Google requires a real OAuth Web Client ID created in Google Cloud.
  // The public client id is loaded from /backend/api/config so it only has
  // to be configured once on the server.
  let googleClientIdPromise = null;
  async function getGoogleClientId(){
    if(window.GOOGLE_CLIENT_ID) return window.GOOGLE_CLIENT_ID;
    if(googleClientIdPromise) return googleClientIdPromise;
    googleClientIdPromise = (async () => {
      const base = (window.__genzBackend && window.__genzBackend.apiBase) || (window.GENZ_API_BASE || 'backend');
      try{
        const res = await fetch(base + '/api/config', { cache:'no-store' });
        const data = await res.json().catch(() => ({}));
        const id = String(data.googleClientId || '').trim();
        if(id) window.GOOGLE_CLIENT_ID = id;
        return id;
      }catch(err){
        return '';
      }
    })();
    return googleClientIdPromise;
  }

  async function handleGoogleCredentialResponse(response){
    try{
      const backendBase = (window.__genzBackend && window.__genzBackend.apiBase) || (window.GENZ_API_BASE || 'backend');
      const res = await fetch(backendBase + '/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: response.credential })
      });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || 'Google sign-in failed');
      try{ playSound('success'); }catch(err){}
      recordLogin({ name: data.name || data.email, email: data.email, provider: 'Google' });
      setCurrentUser({ name: data.name || data.email, email: data.email, picture: data.picture || '' });
      updateLoginButtonUI();
      showScreen('main');
    }catch(err){
      console.warn('Google sign-in failed', err);
      const msgEl = document.getElementById('buyerMsg');
      if(msgEl) showFieldError(msgEl, err.message || 'Google sign-in could not be completed.');
    }
  }

  const googleSignInBtn = document.getElementById('googleSignInBtn');
  if(googleSignInBtn){
    const initGoogleIdentity = async () => {
      if(!(window.google && window.google.accounts && window.google.accounts.id)) return false;
      const clientId = await getGoogleClientId();
      if(!clientId){
        const msgEl = document.getElementById('buyerMsg');
        if(msgEl) showFieldError(msgEl, 'Google Login needs a Google OAuth Client ID. Add it in backend/config.php and try again.');
        return false;
      }
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleGoogleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true
      });
      return true;
    };
    googleSignInBtn.addEventListener('click', async () => {
      const ok = await initGoogleIdentity();
      if(ok) window.google.accounts.id.prompt();
      else if(!(window.google && window.google.accounts && window.google.accounts.id)){
        const msgEl = document.getElementById('buyerMsg');
        if(msgEl) showFieldError(msgEl, 'Google Sign-In is still loading. Check your internet connection and try again.');
      }
    });
  }

  // ---------- Admin PIN — second security layer ----------
  // Only reached after the email + password already matched in the
  // unified Sign In form above. A correct PIN here is what actually
  // grants the admin session.
  const adminPinForm = document.getElementById('adminPinForm');
  if(adminPinForm){
    adminPinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pinInput = document.getElementById('adminPinInput');
      const pinMsg = document.getElementById('adminPinMsg');
      const pin = pinInput.value.trim();
      const pinHash = await hashPassword(pin);
      if(pinHash === ADMIN_PIN_HASH){
        // Also log in against the backend server, which independently
        // checks the PIN and issues a real session token — this is what
        // actually authorizes add/edit/delete calls to the backend.
        try{
          if(!window.__genzBackend) throw new Error('Backend is not available');
          await window.__genzBackend.adminLogin(ADMIN_EMAIL, pin);
        }catch(err){
          showFieldError(pinMsg, 'Admin server login failed. Check backend/config.php and the database connection.');
          return;
        }
        closeModal('adminPinOverlay');
        isAdmin = true;
        document.body.classList.add('is-admin');
        updateAdminNavButtonUI();
        try{ if(window.__products) window.__products.render(); }catch(err){ /* products module unavailable */ }
        try{ if(window.__content){ window.__content.renderTeam(); window.__content.renderServices(); } }catch(err){ /* content module unavailable */ }
        try{ playSound('success'); }catch(err){ /* sound module unavailable */ }
        const msgTarget = pendingAdminMsgEl || document.getElementById('buyerMsg');
        goToMain(msgTarget, 'Admin verified — loading dashboard view…');
        // Bring the admin straight into the full control panel once the
        // storefront screen is in view.
        setTimeout(() => {
          try{
            const overlay = document.getElementById('adminOverlay');
            if(overlay && typeof window.__renderAdminList === 'function'){
              window.__renderAdminList();
              if(typeof window.__renderAdminUsersList === 'function') window.__renderAdminUsersList();
              if(typeof window.__renderAnalytics === 'function') window.__renderAnalytics();
              overlay.classList.add('open');
            }
          }catch(err){ console.warn('Could not auto-open admin panel', err); }
        }, 1000);
      } else {
        showFieldError(pinMsg, 'Incorrect PIN. Try again.');
        pinInput.focus();
      }
    });
  }
  const adminPinClose = document.getElementById('adminPinClose');
  if(adminPinClose){
    adminPinClose.addEventListener('click', () => closeModal('adminPinOverlay'));
  }
  const adminPinOverlay = document.getElementById('adminPinOverlay');
  if(adminPinOverlay){
    adminPinOverlay.addEventListener('click', (e) => {
      if(e.target.id === 'adminPinOverlay') closeModal('adminPinOverlay');
    });
  }

  }catch(err){ console.warn('Login form setup failed', err); }

  try{

  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      btn.innerHTML = `<i data-lucide="${showing ? 'eye' : 'eye-off'}"></i>`;
      refreshIcons();
    });
  });

  }catch(err){ console.warn('Password toggle setup failed', err); }

  try{

  // ============================================================
  // STRIPE PAYMENT LINK — CARD CHECKOUT
  // Replace this with your own Stripe Payment Link (Dashboard →
  // Payment Links → + New). Once set, tapping "Pay Now" with Card
  // selected opens Stripe's secure hosted checkout in a new tab —
  // real card payments are then processed by Stripe, not this site.
  // ============================================================
  const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/REPLACE_WITH_YOUR_LINK';

  var _cardNumberEl = document.getElementById('cardNumber');
  if(_cardNumberEl) _cardNumberEl.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g,'').slice(0,16).replace(/(.{4})/g,'$1 ').trim();
  });
  var _cardExpiryEl = document.getElementById('cardExpiry');
  if(_cardExpiryEl) _cardExpiryEl.addEventListener('input', (e) => {
    let v = e.target.value.replace(/\D/g,'').slice(0,4);
    if(v.length > 2) v = v.slice(0,2) + '/' + v.slice(2);
    e.target.value = v;
  });
  var _cardCvvEl = document.getElementById('cardCvv');
  if(_cardCvvEl) _cardCvvEl.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g,'').slice(0,4);
  });

  // Reads and validates the shipping address fields. Returns the address
  // object, or null (with an inline error shown) if something required
  // is missing — this runs before any payment method so we never take a
  // payment without knowing where the order actually has to go.
  function readShippingAddress(){
    const payMsg = document.getElementById('payMsg');
    const fields = {
      name: document.getElementById('shipFullName'),
      phone: document.getElementById('shipPhone'),
      address: document.getElementById('shipAddress'),
      city: document.getElementById('shipCity'),
      postal: document.getElementById('shipPostal'),
      email: document.getElementById('shipEmail')
    };
    const required = ['name','phone','address','city','email'];
    for(const key of required){
      if(!fields[key] || !fields[key].value.trim()){
        showFieldError(payMsg, 'Please fill in your shipping address (name, phone, address, city and email) before paying.');
        fields[key] && fields[key].focus();
        return null;
      }
    }
    if(!fields.email.value.includes('@')){
      showFieldError(payMsg, 'Please enter a valid email so we can send order tracking updates.');
      fields.email.focus();
      return null;
    }
    return {
      name: fields.name.value.trim(),
      phone: fields.phone.value.trim(),
      address: fields.address.value.trim(),
      city: fields.city.value.trim(),
      postal: fields.postal.value.trim(),
      email: fields.email.value.trim().toLowerCase()
    };
  }

  // Saves a placed order to local storage (keyed by the shipping email)
  // so the Track Order modal can look it up and show its status later.
  function saveNewOrder(orderNumber, method, shipping){
    const items = cart.map(i => ({ name: i.name, price: i.price, qty: i.qty }));
    const total = Math.round(getCartTotal() * 100) / 100;
    const orders = loadOrders();
    orders.unshift({
      orderNumber,
      buyerEmail: shipping.email,
      date: new Date().toISOString(),
      items,
      total,
      discountCode: appliedDiscount ? appliedDiscount.code : null,
      method,
      shipping
    });
    saveOrders(orders);
    // Remember this email so the buyer isn't asked to retype it when they
    // open Track Order right after checking out.
    try{ localStorage.setItem('genz_last_order_email', shipping.email); }catch(err){ /* storage unavailable */ }
  }

  document.getElementById('paymentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if(cart.length === 0){ return; }
    const shipping = readShippingAddress();
    if(!shipping) return;
    const activeTab = document.querySelector('.pay-method-tab.active');
    const method = activeTab ? activeTab.dataset.method : 'card';
    const payMsg = document.getElementById('payMsg');
    const payBtn = document.getElementById('payBtn');

    // Cart items in the shape the backend expects.
    const backendItems = cart.map(i => ({ name: i.name, price_usd: i.price, qty: i.qty }));
    const buyer = { email: shipping.email, name: shipping.name, phone: shipping.phone, address: shipping.address, city: shipping.city };

    if(method === 'card'){
      // Try the real backend Stripe integration first.
      if(window.__genzBackend){
        try{
          payBtn.disabled = true;
          const { url, orderNumber } = await window.__genzBackend.createStripeCheckout(backendItems, buyer);
          saveNewOrder(orderNumber, 'card', shipping);
          payMsg.innerHTML = `Redirecting to secure Stripe checkout for order <span class="order-number">#${orderNumber}</span>…`;
          payMsg.classList.add('show');
          window.location.href = url;
          return;
        }catch(err){
          console.warn('Backend Stripe checkout unavailable, falling back.', err);
          payBtn.disabled = false;
        }
      }
      // Fallback: old behavior via a manually-configured Stripe Payment Link.
      if(!STRIPE_PAYMENT_LINK || STRIPE_PAYMENT_LINK.includes('REPLACE_WITH_YOUR_LINK')){
        payMsg.innerHTML = 'Card checkout isn\'t connected yet — start the backend server (see genz-backend/README.md) or add a Stripe Payment Link. Try Bank or JazzCash for now.';
        payMsg.classList.add('show');
        setTimeout(() => payMsg.classList.remove('show'), 3400);
        return;
      }
      const cardOrderNumber = 'GZ-' + Math.floor(100000 + Math.random() * 900000);
      saveNewOrder(cardOrderNumber, 'card', shipping);
      payMsg.innerHTML = `Opening secure Stripe checkout in a new tab… your order <span class="order-number">#${cardOrderNumber}</span> is saved — track it anytime from "Track Order".`;
      payMsg.classList.add('show');
      window.open(STRIPE_PAYMENT_LINK, '_blank', 'noopener');
      setTimeout(() => {
        cart = [];
        appliedDiscount = null;
        renderCart();
        payMsg.classList.remove('show');
        closeModal('cartOverlay');
        e.target.reset();
      }, 2200);
      return;
    }

    if(method === 'jazzcash' && window.__genzBackend){
      try{
        payBtn.disabled = true;
        const { actionUrl, fields, orderNumber } = await window.__genzBackend.initiateJazzCash(backendItems, buyer);
        saveNewOrder(orderNumber, 'jazzcash', shipping);
        payMsg.innerHTML = `Redirecting to JazzCash to complete order <span class="order-number">#${orderNumber}</span>…`;
        payMsg.classList.add('show');
        window.__genzBackend.submitToJazzCash(actionUrl, fields);
        return;
      }catch(err){
        console.warn('Backend JazzCash payment unavailable, falling back to manual confirmation.', err);
        payBtn.disabled = false;
      }
    }

    if(method === 'cod'){
      let orderNumber = 'GZ-' + Math.floor(100000 + Math.random() * 900000);
      try{
        if(window.__genzBackend){
          payBtn.disabled = true;
          const saved = await window.__genzBackend.createCODOrder(backendItems, buyer);
          if(saved && saved.orderNumber) orderNumber = saved.orderNumber;
        }else{
          throw new Error('Backend unavailable');
        }
      }catch(err){
        console.warn('COD backend order failed:', err);
        payBtn.disabled = false;
        showFieldError(payMsg, 'Could not save your COD order. Please try again.');
        return;
      }
      saveNewOrder(orderNumber, 'cod', shipping);
      payMsg.innerHTML = `COD order <span class="order-number">#${orderNumber}</span> confirmed. Pay the courier when your package arrives.`;
      payMsg.classList.add('show');
      payBtn.textContent = 'Order Confirmed';
      setTimeout(() => {
        cart = [];
        appliedDiscount = null;
        renderCart();
        closeModal('cartOverlay');
        payMsg.classList.remove('show');
        payBtn.textContent = 'Place Order';
        payBtn.disabled = false;
        e.target.reset();
      }, 2600);
      return;
    }

    // Bank transfer: save a real order record in MySQL; payment is confirmed
    // manually after the customer sends the transfer receipt.
    let orderNumber = 'GZ-' + Math.floor(100000 + Math.random() * 900000);
    if(window.__genzBackend){
      try{
        const saved = await window.__genzBackend.createBankOrder(backendItems, buyer);
        if(saved && saved.orderNumber) orderNumber = saved.orderNumber;
      }catch(err){
        console.warn('Could not record order on backend — using local order number.', err);
      }
    }
    saveNewOrder(orderNumber, method, shipping);
    payMsg.innerHTML = `Bank-transfer order <span class="order-number">#${orderNumber}</span> saved. Send your receipt to support@example.com to confirm payment.`;
    payMsg.classList.add('show');
    payBtn.textContent = 'Order Saved';
    setTimeout(() => {
      cart = [];
      appliedDiscount = null;
      renderCart();
      closeModal('cartOverlay');
      payMsg.classList.remove('show');
      payBtn.textContent = 'Place Order';
      payBtn.disabled = false;
      e.target.reset();
    }, 2600);
  });

  }catch(err){ console.warn('Payment form setup failed', err); }

  try{

  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  const navMenuPanel = document.getElementById('navMenuPanel');
  navToggle.addEventListener('click', () => navMenuPanel.classList.toggle('open'));
  navLinks.querySelectorAll('a').forEach(a => a.addEventListener('click', () => navMenuPanel.classList.remove('open')));

  // ---------- Nav actions on mobile: close the dropdown after a tap ----------
  // The action row (language, admin login/logout, cart, wishlist, login...)
  // now lives inside the same slide-down panel as the nav links. Once
  // someone taps one of those buttons, close the panel so it doesn't stay
  // open over whatever screen/overlay the button just triggered. The
  // language <select> is excluded so picking a language doesn't instantly
  // collapse the menu before the change registers.
  const navActionsEl = document.querySelector('.nav-actions');
  if(navActionsEl && navMenuPanel){
    navActionsEl.querySelectorAll('button.nav-icon-btn').forEach(btn => {
      btn.addEventListener('click', () => navMenuPanel.classList.remove('open'));
    });
  }

  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        entry.target.classList.add('in-view');
        entry.target.style.animationPlayState = 'running';
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  // Exposed so dynamically-rendered content (team/service cards, which are
  // rebuilt by JS after this block runs) can opt into the same fade-up
  // entrance animation once they exist in the DOM.
  function applyReveal(elements){
    elements.forEach((el, i) => {
      el.style.opacity = '0';
      el.style.animation = `slideUp 0.8s cubic-bezier(.16,1,.3,1) forwards`;
      el.style.animationDelay = (i * 0.06) + 's';
      el.style.animationPlayState = 'paused';
      revealObserver.observe(el);
    });
  }

  document.querySelectorAll('#about, #services, #team, #contact, #shop, #lookbook, #faq, #reviews, #newsletter, #instagram, #blog, #news').forEach(sec => {
    applyReveal(sec.querySelectorAll('h2, .pull-quote, .service-card, .team-card, .stat, .about-image, .contact-left, form, .shop-toolbar, .lookbook-card, .faq-item, .review-card, .newsletter-inner, .insta-card, .blog-card, .news-item'));
  });

  }catch(err){ console.warn('Nav/reveal setup failed', err); }

  // ---------- Animated count-up numbers (About stats row) ----------
  try{
    const countReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const countEls = document.querySelectorAll('[data-count-to]');
    const countObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if(!entry.isIntersecting) return;
        const el = entry.target;
        const target = parseInt(el.dataset.countTo, 10) || 0;
        countObserver.unobserve(el);
        if(countReduceMotion){ el.textContent = target; return; }
        const duration = 1400;
        const startTime = performance.now();
        function tick(now){
          const progress = Math.min(1, (now - startTime) / duration);
          const eased = 1 - Math.pow(1 - progress, 3);
          el.textContent = Math.round(target * eased);
          if(progress < 1) requestAnimationFrame(tick);
          else el.textContent = target;
        }
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.4 });
    countEls.forEach(el => countObserver.observe(el));
  }catch(err){ console.warn('Count-up setup failed', err); }

  try{

  // ---------- 3D tilt effect (product, service, lookbook cards) ----------
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isTouchDevice = window.matchMedia('(hover: none), (pointer: coarse)').matches;

  function initTilt(selector, { maxTilt = 9, lift = true, glareTarget } = {}){
    if(prefersReducedMotion || isTouchDevice) return;
    document.querySelectorAll(selector).forEach(card => {
      const glareEl = glareTarget ? card.querySelector(glareTarget) || card : card;

      function handleMove(e){
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        const rotateY = (px - 0.5) * maxTilt * 2;
        const rotateX = (0.5 - py) * maxTilt * 2;
        const translateY = lift ? -6 : 0;
        card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(${translateY}px)`;
        glareEl.style.setProperty('--mx', `${px * 100}%`);
        glareEl.style.setProperty('--my', `${py * 100}%`);
      }
      function reset(){
        card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0)';
      }
      card.addEventListener('mousemove', handleMove);
      card.addEventListener('mouseleave', reset);
    });
  }

  initTilt('.product-card', { maxTilt: 7, glareTarget: '.product-photo' });
  initTilt('.service-card', { maxTilt: 8 });
  initTilt('.lookbook-card', { maxTilt: 6, lift: false });
  initTilt('.insta-card', { maxTilt: 10, lift: true });
  initTilt('.team-card', { maxTilt: 6, lift: true });
  initTilt('.about-image', { maxTilt: 5, lift: false });
  initTilt('.stat', { maxTilt: 10, lift: false });
  initTilt('.promo-ad-card', { maxTilt: 9, lift: false });

  }catch(err){ console.warn('3D tilt setup failed', err); }

  try{

  // ---------- FAQ accordion ----------
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      const isOpen = item.classList.contains('open');
      document.querySelectorAll('.faq-item.open').forEach(openItem => {
        if(openItem !== item){
          openItem.classList.remove('open');
          openItem.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
        }
      });
      item.classList.toggle('open', !isOpen);
      btn.setAttribute('aria-expanded', String(!isOpen));
    });
  });

  }catch(err){ console.warn('FAQ setup failed', err); }

  try{

  const newsletterForm = document.getElementById('newsletterForm');
  const newsletterMsg = document.getElementById('newsletterMsg');
  newsletterForm.addEventListener('submit', (e) => {
    e.preventDefault();
    newsletterMsg.classList.add('show');
    newsletterForm.reset();
    setTimeout(() => newsletterMsg.classList.remove('show'), 4000);
  });

  const contactForm = document.querySelector('#contact form');
  const contactMsg = document.getElementById('contactMsg');
  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    contactMsg.classList.add('show');
    contactForm.reset();
    setTimeout(() => contactMsg.classList.remove('show'), 4000);
  });

  }catch(err){ console.warn('Newsletter/contact form setup failed', err); }

  // ============================================================
  // PROMO AD BANNER (About section)
  // Clicking a promo card jumps to the shop with a matching filter,
  // or straight into checkout for the payment-methods card.
  // ============================================================
  try{
  const promoCards = document.querySelectorAll('.promo-ad-card');
  const promoActions = ['Fragrance', 'Bottoms', 'checkout'];
  promoCards.forEach((card, i) => {
    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
      try{ playSound('swoosh'); }catch(err){ /* sound module unavailable */ }
      const action = promoActions[i];
      if(action === 'checkout'){
        renderCart();
        openModal('cartOverlay');
        return;
      }
      document.getElementById('shop').scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => {
        const pill = document.querySelector(`.filter-pill[data-category="${action}"]`);
        if(pill) pill.click();
      }, 400);
    });
  });
  }catch(err){ console.warn('Promo ad banner setup failed', err); }

  // ============================================================
  // ABOUT SECTION AD CAROUSEL
  // Auto-rotates the slides inside the about-image box every 4s.
  // ============================================================
  try{
  const aboutReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(typeof window.renderAboutAds === 'function') window.renderAboutAds();
  if(!aboutReduceMotion){
    setInterval(() => {
      const state = window.__aboutAdsState;
      if(!state || state.list.length < 2) return;
      state.index = (state.index + 1) % state.list.length;
      if(typeof window.renderAboutAds === 'function') window.renderAboutAds();
      refreshIcons();
    }, 4000);
  }
  }catch(err){ console.warn('About ad carousel setup failed', err); }

  // ============================================================
  // SOUND EFFECTS MODULE (Web Audio API — no external audio files)
  // Produces short, low-fidelity mechanical UI clicks/swooshes that
  // are entirely synthesized in the browser.
  // ============================================================
  try{

  const SOUND_KEY = 'genz_sound_enabled';
  let soundEnabled = localStorage.getItem(SOUND_KEY) === '1';
  let audioCtx = null;

  function ensureAudioCtx(){
    if(!audioCtx){
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if(!Ctx) return null;
      audioCtx = new Ctx();
    }
    if(audioCtx.state === 'suspended'){ audioCtx.resume(); }
    return audioCtx;
  }

  // Exposed globally so every other module (cart, admin panel, nav) can
  // trigger a sound without worrying about load order.
  window.playSound = function(type){
    if(!soundEnabled) return;
    const ctx = ensureAudioCtx();
    if(!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if(type === 'swoosh'){
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(680, now + 0.16);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.06, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
      osc.start(now); osc.stop(now + 0.22);
    } else if(type === 'add'){
      osc.type = 'square';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(760, now + 0.09);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
      osc.start(now); osc.stop(now + 0.15);
    } else if(type === 'success'){
      [523, 659, 784].forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'triangle';
        o.frequency.value = freq;
        o.connect(g); g.connect(ctx.destination);
        const t = now + i * 0.09;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.start(t); o.stop(t + 0.2);
      });
      osc.disconnect();
    } else {
      // 'click' — a clean, minimal mechanical UI click.
      osc.type = 'square';
      osc.frequency.setValueAtTime(600, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
      osc.start(now); osc.stop(now + 0.05);
    }
  };

  function updateSoundBtn(){
    const btn = document.getElementById('soundToggleBtn');
    if(!btn) return;
    btn.classList.toggle('muted', !soundEnabled);
    btn.setAttribute('aria-pressed', String(soundEnabled));
  }
  updateSoundBtn();

  const soundToggleBtn = document.getElementById('soundToggleBtn');
  if(soundToggleBtn){
    soundToggleBtn.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      try{ localStorage.setItem(SOUND_KEY, soundEnabled ? '1' : '0'); }catch(err){ /* storage unavailable */ }
      updateSoundBtn();
      if(soundEnabled) window.playSound('click');
    });
  }

  // Wire clean click/swoosh sounds to common navigation and entry actions.
  const soundOnClickSelectors = ['#enterSiteBtn','#backToWelcome','.nav-links a','#loginBtn','#cartBtn','#wishlistBtn','#paymentBtn','.tab-btn','.filter-pill'];
  document.querySelectorAll(soundOnClickSelectors.join(',')).forEach(el => {
    el.addEventListener('click', () => window.playSound('swoosh'));
  });

  }catch(err){ console.warn('Sound effects module setup failed', err); }

  // ============================================================
  // LIVE DROP COUNTDOWN TIMER
  // Persists its target time in localStorage so it counts down
  // consistently across refreshes, then loops to a new drop window
  // once it hits zero.
  // ============================================================
  try{

  const CD_KEY = 'genz_drop_target';
  const CD_DEFAULT_MS = ((2 * 24 + 14) * 60 + 35) * 60 * 1000 + 12 * 1000; // 02d:14h:35m:12s

  function getDropTarget(){
    let target = Number(localStorage.getItem(CD_KEY));
    if(!target || target <= Date.now()){
      target = Date.now() + CD_DEFAULT_MS;
      try{ localStorage.setItem(CD_KEY, String(target)); }catch(err){ /* storage unavailable */ }
    }
    return target;
  }

  let dropTarget = getDropTarget();
  const cdDaysEl = document.getElementById('cdDays');
  const cdHoursEl = document.getElementById('cdHours');
  const cdMinutesEl = document.getElementById('cdMinutes');
  const cdSecondsEl = document.getElementById('cdSeconds');
  const pad2 = (n) => String(Math.max(0, n)).padStart(2, '0');

  function tickCountdown(){
    let diff = dropTarget - Date.now();
    if(diff <= 0){
      // Drop just went live — loop into a fresh countdown window.
      dropTarget = Date.now() + CD_DEFAULT_MS;
      try{ localStorage.setItem(CD_KEY, String(dropTarget)); }catch(err){ /* storage unavailable */ }
      diff = dropTarget - Date.now();
    }
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    if(cdDaysEl) cdDaysEl.textContent = pad2(days);
    if(cdHoursEl) cdHoursEl.textContent = pad2(hours);
    if(cdMinutesEl) cdMinutesEl.textContent = pad2(minutes);
    if(cdSecondsEl) cdSecondsEl.textContent = pad2(seconds);
  }
  tickCountdown();
  setInterval(tickCountdown, 1000);

  }catch(err){ console.warn('Countdown timer setup failed', err); }

  // ============================================================
  // CUSTOM CURSOR TRAILER
  // A small dot follows the cursor with a slight lag; it expands
  // into a "VIEW PRODUCT" ring when hovering a product card.
  // Disabled on touch devices and when reduced motion is preferred.
  // ============================================================
  try{

  const cursorReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cursorTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches;

  if(!cursorReduceMotion && !cursorTouch){
    const dot = document.getElementById('cursorDot');
    const ring = document.getElementById('cursorRing');
    if(dot && ring){
      let mouseX = window.innerWidth / 2, mouseY = window.innerHeight / 2;
      let dotX = mouseX, dotY = mouseY, ringX = mouseX, ringY = mouseY;
      let started = false;

      document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX; mouseY = e.clientY;
        if(!started){ started = true; document.body.classList.add('cursor-active'); }
      });

      document.addEventListener('mouseover', (e) => {
        if(e.target.closest && e.target.closest('.product-card')){
          ring.classList.add('view-mode');
          dot.classList.add('view-mode');
          ring.textContent = 'VIEW PRODUCT';
        }
      });
      document.addEventListener('mouseout', (e) => {
        const toCard = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.product-card');
        const fromCard = e.target.closest && e.target.closest('.product-card');
        if(fromCard && !toCard){
          ring.classList.remove('view-mode');
          dot.classList.remove('view-mode');
          ring.textContent = '';
        }
      });

      function animateCursor(){
        // Dot tracks quickly; ring trails behind with more lag for a
        // smooth "trailer" feel.
        dotX += (mouseX - dotX) * 0.35;
        dotY += (mouseY - dotY) * 0.35;
        ringX += (mouseX - ringX) * 0.14;
        ringY += (mouseY - ringY) * 0.14;
        dot.style.transform = `translate(${dotX}px, ${dotY}px) translate(-50%,-50%)`;
        ring.style.transform = `translate(${ringX}px, ${ringY}px) translate(-50%,-50%)`;
        requestAnimationFrame(animateCursor);
      }
      requestAnimationFrame(animateCursor);
    }
  }

  }catch(err){ console.warn('Custom cursor setup failed', err); }

  // ============================================================
  // 3D GLOWING LOGIN SCREEN
  // Floating grid + drifting particles behind the login card, and a
  // pronounced 3D tilt with a cursor-tracked ambient glow on the
  // card itself.
  // ============================================================
  try{

  const loginReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const loginTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches;

  // Seed a handful of soft drifting particles behind the login card.
  const particleHost = document.getElementById('loginParticles');
  if(particleHost && !loginReduceMotion){
    const particleCount = window.matchMedia('(max-width: 760px)').matches ? 8 : 22;
    for(let i = 0; i < particleCount; i++){
      const p = document.createElement('div');
      p.className = 'login-particle';
      const size = 2 + Math.random() * 4;
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      p.style.left = Math.random() * 100 + '%';
      p.style.top = 30 + Math.random() * 60 + '%';
      p.style.animationDuration = (6 + Math.random() * 8) + 's';
      p.style.animationDelay = (Math.random() * 8) + 's';
      particleHost.appendChild(p);
    }
  }

  const loginCard = document.getElementById('loginCard');
  const loginShopFloat = document.getElementById('loginShopFloat');
  if(loginCard && !loginReduceMotion && !loginTouch){
    const loginInner = document.querySelector('.login-inner');
    function handleLoginMove(e){
      const rect = loginCard.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;
      const clampedPx = Math.min(1, Math.max(0, px));
      const clampedPy = Math.min(1, Math.max(0, py));
      const maxTilt = 12;
      const rotateY = (clampedPx - 0.5) * maxTilt * 2;
      const rotateX = (0.5 - clampedPy) * maxTilt * 2;
      loginCard.style.transform = `perspective(1200px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(0)`;
      loginCard.style.setProperty('--mx', `${clampedPx * 100}%`);
      loginCard.style.setProperty('--my', `${clampedPy * 100}%`);
      // Ambient neon/warm glow outline that shifts with the cursor.
      const glowX = (clampedPx - 0.5) * 36;
      const glowY = (clampedPy - 0.5) * 36;
      loginCard.style.boxShadow = `${glowX}px ${glowY}px 60px -18px rgba(200,169,106,0.5), ${-glowX * 0.6}px ${-glowY * 0.6}px 40px -22px rgba(216,203,180,0.4), 0 0 0 1px rgba(200,169,106,0.25)`;
      // Product photos sit on a deeper 3D layer behind the card and drift the
      // opposite way, in a small clamped range, so they read as a parallax
      // backdrop but always stay attached inside the page — never off-frame.
      if(loginShopFloat){
        const driftX = (clampedPx - 0.5) * -22;
        const driftY = (clampedPy - 0.5) * -18;
        const tiltX = (0.5 - clampedPy) * 5;
        const tiltY = (clampedPx - 0.5) * 5;
        loginShopFloat.style.transform = `perspective(1400px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) translate3d(${driftX}px, ${driftY}px, 0)`;
      }
    }
    function resetLoginCard(){
      loginCard.style.transform = 'perspective(1200px) rotateX(0deg) rotateY(0deg)';
      loginCard.style.boxShadow = '0 0 0 1px rgba(200,169,106,0.08), 0 25px 60px -20px rgba(34,31,28,0.35)';
      if(loginShopFloat){
        loginShopFloat.style.transform = 'perspective(1400px) rotateX(0deg) rotateY(0deg) translate3d(0,0,0)';
      }
    }
    if(loginInner && !loginTouch){
      loginInner.addEventListener('mousemove', handleLoginMove);
      loginInner.addEventListener('mouseleave', resetLoginCard);
    }
  }

  }catch(err){ console.warn('Login screen 3D effect setup failed', err); }

  // ============================================================
  // HERO 3D HEADLINE TILT
  // "Define Your Generation" tilts in 3D following the cursor (mouse)
  // or device orientation (touch), for a floating depth effect.
  // ============================================================
  try{
    const heroReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const heroTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches;
    const heroSection = document.getElementById('hero');
    const heroHeadline = document.getElementById('heroHeadline');
    if(heroSection && heroHeadline && !heroReduceMotion && !heroTouch){
      // Continuous idle float — a gentle looping sine-wave rotation that
      // never fully stops, so the 3D headline is always alive even before
      // anyone touches the mouse.
      let targetRX = 0, targetRY = 0;   // cursor-driven target tilt
      let curRX = 0, curRY = 0;         // smoothed, currently-rendered tilt
      const maxTilt = 10;
      let start = performance.now();

      function frame(now){
        const t = (now - start) / 1000;
        const idleRX = Math.sin(t * 0.55) * 2.2;
        const idleRY = Math.cos(t * 0.4) * 3.2;
        // Ease the rendered tilt toward (idle + cursor target) for a smooth,
        // springy feel instead of an abrupt jump on every mousemove.
        curRX += ((idleRX + targetRX) - curRX) * 0.06;
        curRY += ((idleRY + targetRY) - curRY) * 0.06;
        heroHeadline.style.transform = `rotateX(${curRX.toFixed(2)}deg) rotateY(${curRY.toFixed(2)}deg) translateZ(14px)`;
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);

      if(!heroTouch){
        heroSection.addEventListener('mousemove', (e) => {
          const rect = heroSection.getBoundingClientRect();
          const px = (e.clientX - rect.left) / rect.width - 0.5;
          const py = (e.clientY - rect.top) / rect.height - 0.5;
          targetRX = -py * maxTilt;
          targetRY = px * maxTilt;
        });
        heroSection.addEventListener('mouseleave', () => { targetRX = 0; targetRY = 0; });
      }
    }
  }catch(err){ console.warn('Hero 3D tilt setup failed', err); }

  // ============================================================
  // SCROLL PARALLAX — hero glows and watermark text drift at
  // different speeds than the page scroll, adding depth as the
  // visitor scrolls past the hero.
  // ============================================================
  try{
    const parallaxReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const heroBgText = document.querySelector('.hero-bg-text');
    if(!parallaxReduceMotion && heroBgText){
      let ticking = false;
      function onScrollParallax(){
        const y = window.scrollY;
        heroBgText.style.transform = `translate(-50%, calc(-50% + ${y * 0.12}px))`;
        ticking = false;
      }
      window.addEventListener('scroll', () => {
        if(!ticking){ requestAnimationFrame(onScrollParallax); ticking = true; }
      }, { passive: true });
    }
  }catch(err){ console.warn('Scroll parallax setup failed', err); }

  // ============================================================
  // "OUR STORY" REVEAL ANIMATION
  // Clicking Our Story smooth-scrolls to About and plays a short
  // GEN_Z-style glitch/pop reveal on the section once it arrives.
  // ============================================================
  try{
    const ourStoryBtn = document.getElementById('ourStoryBtn');
    const aboutSection = document.getElementById('about');
    if(ourStoryBtn && aboutSection){
      ourStoryBtn.addEventListener('click', () => {
        setTimeout(() => {
          aboutSection.classList.remove('story-pulse');
          // Force reflow so the animation can be re-triggered on repeat clicks.
          void aboutSection.offsetWidth;
          aboutSection.classList.add('story-pulse');
          setTimeout(() => aboutSection.classList.remove('story-pulse'), 900);
        }, 350);
      });
    }
  }catch(err){ console.warn('Our Story reveal setup failed', err); }

  // ============================================================
  // MULTI-LANGUAGE (English / Urdu / French / German / Korean / Spanish)
  // Dropdown in the navbar swaps text on every element tagged
  // with [data-i18n="key"] using the dictionary below. Dynamically
  // rendered content (products, team bios, admin-managed text) is
  // data-driven from the admin panel and stays in whatever language
  // it was entered in — add more [data-i18n] tags + dictionary
  // entries below to extend translation coverage further.
  // ============================================================
  try{
    const TRANSLATIONS = {
      en: {
        navAbout: 'About', navShop: 'Shop', navLookbook: 'Lookbook', navServices: 'Services',
        navTeam: 'Team', navBlog: 'Blog', navNews: 'News', navFaq: 'FAQ', navContact: 'Contact',
        heroEyebrow: 'Streetwear / Est. 2018',
        heroWord1: 'DEFINE', heroWord2: 'YOUR', heroWord3: 'GENERATION',
        heroSub: "Clothing built for the culture that refuses to wait its turn. No trends borrowed — only made.",
        heroCta1: 'Shop Now', heroCta2: 'Our Story',
        aboutEyebrow: 'About Us', aboutQuote: "We don't follow the season. We set it.",
        shopTitle: 'Shop The Drop',
        lookbookTitle: 'Lookbook', lookbookEyebrow: 'SS26 Campaign',
        servicesTitle: 'What We Do', servicesEyebrow: 'Offerings',
        teamTitle: 'The Crew', teamEyebrow: 'Team',
        blogTitle: 'From The Blog', blogEyebrow: 'Stories & Style Guides',
        newsTitle: 'Latest News', newsEyebrow: 'Announcements',
        faqTitle: 'FAQ', faqEyebrow: 'Good To Know',
        contactEyebrow: 'Get In Touch', contactTitle: "LET'S TALK",
        reviewsTitle: 'Customer Reviews', reviewsEyebrow: 'Trusted',
        newsletterTitle: 'Join Our Newsletter', newsletterSub: 'Get updates about new drops and exclusive offers.'
      },
      ur: {
        navAbout: 'ہمارے بارے میں', navShop: 'شاپ', navLookbook: 'لک بک', navServices: 'خدمات',
        navTeam: 'ٹیم', navBlog: 'بلاگ', navNews: 'خبریں', navFaq: 'سوالات', navContact: 'رابطہ',
        heroEyebrow: 'اسٹریٹ ویئر / قائم 2018',
        heroWord1: 'اپنی', heroWord2: 'نسل کی', heroWord3: 'تعریف کریں',
        heroSub: 'ایسا لباس جو اس کلچر کے لیے بنایا گیا ہے جو انتظار کرنا نہیں جانتا۔ کوئی ادھار کا ٹرینڈ نہیں — صرف اپنا بنایا ہوا۔',
        heroCta1: 'ابھی خریدیں', heroCta2: 'ہماری کہانی',
        aboutEyebrow: 'ہمارے بارے میں', aboutQuote: 'ہم موسم کی پیروی نہیں کرتے۔ ہم اسے طے کرتے ہیں۔',
        shopTitle: 'شاپ دی ڈراپ',
        lookbookTitle: 'لک بک', lookbookEyebrow: 'ایس ایس 26 مہم',
        servicesTitle: 'ہم کیا کرتے ہیں', servicesEyebrow: 'خدمات',
        teamTitle: 'ہماری ٹیم', teamEyebrow: 'ٹیم',
        blogTitle: 'بلاگ سے', blogEyebrow: 'کہانیاں اور اسٹائل گائیڈز',
        newsTitle: 'تازہ ترین خبریں', newsEyebrow: 'اعلانات',
        faqTitle: 'اکثر پوچھے گئے سوالات', faqEyebrow: 'جاننا ضروری ہے',
        contactEyebrow: 'رابطہ کریں', contactTitle: 'بات کریں',
        reviewsTitle: 'گاہکوں کے تبصرے', reviewsEyebrow: 'قابلِ اعتماد',
        newsletterTitle: 'ہمارے نیوز لیٹر میں شامل ہوں', newsletterSub: 'نئے ڈراپس اور خصوصی آفرز کی اپڈیٹس حاصل کریں۔'
      },
      fr: {
        navAbout: 'À propos', navShop: 'Boutique', navLookbook: 'Lookbook', navServices: 'Services',
        navTeam: 'Équipe', navBlog: 'Blog', navNews: 'Actualités', navFaq: 'FAQ', navContact: 'Contact',
        heroEyebrow: 'Streetwear / Depuis 2018',
        heroWord1: 'DÉFINIS', heroWord2: 'TA', heroWord3: 'GÉNÉRATION',
        heroSub: "Des vêtements pensés pour une culture qui refuse d'attendre son tour. Aucune tendance empruntée — tout est créé.",
        heroCta1: 'Acheter', heroCta2: 'Notre Histoire',
        aboutEyebrow: 'À Propos', aboutQuote: "Nous ne suivons pas la saison. Nous la créons.",
        shopTitle: 'La Nouvelle Collection',
        lookbookTitle: 'Lookbook', lookbookEyebrow: 'Campagne SS26',
        servicesTitle: 'Nos Services', servicesEyebrow: 'Offres',
        teamTitle: "L'Équipe", teamEyebrow: 'Équipe',
        blogTitle: 'Sur Le Blog', blogEyebrow: 'Histoires & Guides de Style',
        newsTitle: 'Dernières Actualités', newsEyebrow: 'Annonces',
        faqTitle: 'FAQ', faqEyebrow: 'Bon À Savoir',
        contactEyebrow: 'Contactez-Nous', contactTitle: "PARLONS-EN",
        reviewsTitle: 'Avis Clients', reviewsEyebrow: 'De Confiance',
        newsletterTitle: 'Rejoignez Notre Newsletter', newsletterSub: 'Recevez les actualités sur les nouvelles collections et offres exclusives.'
      },
      de: {
        navAbout: 'Über Uns', navShop: 'Shop', navLookbook: 'Lookbook', navServices: 'Leistungen',
        navTeam: 'Team', navBlog: 'Blog', navNews: 'News', navFaq: 'FAQ', navContact: 'Kontakt',
        heroEyebrow: 'Streetwear / Seit 2018',
        heroWord1: 'DEFINIERE', heroWord2: 'DEINE', heroWord3: 'GENERATION',
        heroSub: 'Kleidung für eine Kultur, die nicht warten will. Keine geliehenen Trends — nur Eigenes.',
        heroCta1: 'Jetzt Shoppen', heroCta2: 'Unsere Geschichte',
        aboutEyebrow: 'Über Uns', aboutQuote: 'Wir folgen der Saison nicht. Wir bestimmen sie.',
        shopTitle: 'Der Neue Drop',
        lookbookTitle: 'Lookbook', lookbookEyebrow: 'SS26 Kampagne',
        servicesTitle: 'Was Wir Tun', servicesEyebrow: 'Angebote',
        teamTitle: 'Das Team', teamEyebrow: 'Team',
        blogTitle: 'Vom Blog', blogEyebrow: 'Geschichten & Style-Guides',
        newsTitle: 'Aktuelle News', newsEyebrow: 'Ankündigungen',
        faqTitle: 'FAQ', faqEyebrow: 'Gut Zu Wissen',
        contactEyebrow: 'Kontaktiere Uns', contactTitle: 'SPRECHEN WIR',
        reviewsTitle: 'Kundenbewertungen', reviewsEyebrow: 'Vertrauenswürdig',
        newsletterTitle: 'Newsletter Abonnieren', newsletterSub: 'Erhalte Updates zu neuen Drops und exklusiven Angeboten.'
      },
      ko: {
        navAbout: '소개', navShop: '샵', navLookbook: '룩북', navServices: '서비스',
        navTeam: '팀', navBlog: '블로그', navNews: '뉴스', navFaq: '자주 묻는 질문', navContact: '연락처',
        heroEyebrow: '스트리트웨어 / 2018년 설립',
        heroWord1: '너의', heroWord2: '세대를', heroWord3: '정의하라',
        heroSub: '차례를 기다리지 않는 문화를 위한 옷. 빌려온 트렌드는 없다 — 오직 우리가 만든 것뿐.',
        heroCta1: '지금 쇼핑하기', heroCta2: '우리의 이야기',
        aboutEyebrow: '소개', aboutQuote: '우리는 시즌을 따르지 않는다. 우리가 시즌을 정한다.',
        shopTitle: '신상품 드롭',
        lookbookTitle: '룩북', lookbookEyebrow: 'SS26 캠페인',
        servicesTitle: '우리가 하는 일', servicesEyebrow: '제공 서비스',
        teamTitle: '더 크루', teamEyebrow: '팀',
        blogTitle: '블로그에서', blogEyebrow: '스토리 & 스타일 가이드',
        newsTitle: '최신 소식', newsEyebrow: '공지사항',
        faqTitle: '자주 묻는 질문', faqEyebrow: '알아두면 좋은 정보',
        contactEyebrow: '문의하기', contactTitle: '이야기해요',
        reviewsTitle: '고객 후기', reviewsEyebrow: '신뢰할 수 있는',
        newsletterTitle: '뉴스레터 구독하기', newsletterSub: '신상품 소식과 특별 혜택을 받아보세요.'
      },
      es: {
        navAbout: 'Nosotros', navShop: 'Tienda', navLookbook: 'Lookbook', navServices: 'Servicios',
        navTeam: 'Equipo', navBlog: 'Blog', navNews: 'Noticias', navFaq: 'FAQ', navContact: 'Contacto',
        heroEyebrow: 'Streetwear / Desde 2018',
        heroWord1: 'DEFINE', heroWord2: 'TU', heroWord3: 'GENERACIÓN',
        heroSub: 'Ropa creada para una cultura que se niega a esperar su turno. Ninguna tendencia prestada — solo creada por nosotros.',
        heroCta1: 'Comprar Ahora', heroCta2: 'Nuestra Historia',
        aboutEyebrow: 'Sobre Nosotros', aboutQuote: 'No seguimos la temporada. La marcamos.',
        shopTitle: 'La Nueva Colección',
        lookbookTitle: 'Lookbook', lookbookEyebrow: 'Campaña SS26',
        servicesTitle: 'Lo Que Hacemos', servicesEyebrow: 'Servicios',
        teamTitle: 'El Equipo', teamEyebrow: 'Equipo',
        blogTitle: 'Del Blog', blogEyebrow: 'Historias y Guías de Estilo',
        newsTitle: 'Últimas Noticias', newsEyebrow: 'Anuncios',
        faqTitle: 'Preguntas Frecuentes', faqEyebrow: 'Bueno Saberlo',
        contactEyebrow: 'Contáctanos', contactTitle: 'HABLEMOS',
        reviewsTitle: 'Reseñas de Clientes', reviewsEyebrow: 'Confiable',
        newsletterTitle: 'Únete a Nuestro Newsletter', newsletterSub: 'Recibe novedades sobre nuevos lanzamientos y ofertas exclusivas.'
      }
    };

    const LANG_KEY = 'genz_lang';
    function applyLanguage(lang){
      const dict = TRANSLATIONS[lang] || TRANSLATIONS.en;
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if(dict[key] !== undefined) el.textContent = dict[key];
      });
      const select = document.getElementById('langSelect');
      if(select) select.value = lang;
      // Urdu reads right-to-left — flip the document direction so text
      // and layout mirror correctly; every other supported language is LTR.
      document.documentElement.dir = (lang === 'ur') ? 'rtl' : 'ltr';
      document.documentElement.lang = lang;
      try{ localStorage.setItem(LANG_KEY, lang); }catch(err){ /* storage unavailable */ }
    }

    const langSelectEl = document.getElementById('langSelect');
    let currentLang = 'en';
    try{ currentLang = localStorage.getItem(LANG_KEY) || 'en'; }catch(err){ /* storage unavailable */ }
    if(!TRANSLATIONS[currentLang]) currentLang = 'en';
    applyLanguage(currentLang);
    if(langSelectEl){
      langSelectEl.addEventListener('change', () => {
        currentLang = TRANSLATIONS[langSelectEl.value] ? langSelectEl.value : 'en';
        applyLanguage(currentLang);
        try{ playSound('click'); }catch(err){ /* sound module unavailable */ }
      });
    }
  }catch(err){ console.warn('Language switcher setup failed', err); }

  // ============================================================
  // FINAL INIT
  // Render the storefront grid now that every other module (cart,
  // wishlist, tilt, filters, sound, admin panel) is fully wired up.
  // ============================================================
  try{
    if(window.__products) window.__products.render();
    if(window.__content){ window.__content.renderTeam(); window.__content.renderServices(); }
    if(typeof window.renderAboutAds === 'function') window.renderAboutAds();
    refreshIcons();
  }catch(err){ console.warn('Initial product render failed', err); }

  // ============================================================
  // BACKEND INTEGRATION
  // Connects this page to the genz-backend Express server (see the
  // backend's README for setup). Every call below is wrapped so that
  // if the backend isn't running or isn't configured yet, the site
  // quietly falls back to its original localStorage-only behavior —
  // nothing breaks for anyone testing the frontend on its own.
  //
  // TO GO LIVE: change GENZ_API_BASE to your deployed backend URL.
  // ============================================================
  try{

  const GENZ_API_BASE = window.GENZ_API_BASE || 'backend';
  const ADMIN_TOKEN_KEY = 'genz_admin_token';

  function getAdminToken(){
    try{ return sessionStorage.getItem(ADMIN_TOKEN_KEY); }catch(err){ return null; }
  }
  function setAdminToken(token){
    try{ sessionStorage.setItem(ADMIN_TOKEN_KEY, token); }catch(err){ /* storage unavailable */ }
  }

  async function adminFetch(path, options = {}){
    const token = getAdminToken();
    return fetch(GENZ_API_BASE + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(options.headers || {})
      }
    });
  }

  window.__genzBackend = {
    apiBase: GENZ_API_BASE,

    // Logs the admin in against the SERVER's copy of the PIN hash (not
    // the client-side one) and stores the returned session token.
    async adminLogin(email, pin){
      const res = await fetch(GENZ_API_BASE + '/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, pin })
      });
      if(!res.ok) throw new Error('Backend admin login failed');
      const data = await res.json();
      setAdminToken(data.token);
      return data;
    },

    // Pulls the live catalog from the backend on page load, if reachable.
    async fetchProducts(){
      const res = await fetch(GENZ_API_BASE + '/api/products');
      if(!res.ok) throw new Error('Could not fetch products');
      const rows = await res.json();
      // Backend field names -> the shape the frontend's products module expects.
      return rows.map(r => ({
        id: r.id, name: r.name, price: Number(r.price_usd), category: r.category,
        tag: r.tag || '', stock: r.stock, rating: Number(r.rating) || 0,
        reviews: r.reviews || 0, image: r.image_url
      }));
    },

    // Pushes the admin's full current catalog to the backend (add/edit/
    // archive all flow through here since the frontend already re-saves
    // the whole array on every change — see saveProducts() above).
    async syncProducts(products){
      const res = await adminFetch('/api/products/sync', {
        method: 'POST',
        body: JSON.stringify({ products })
      });
      if(!res.ok) throw new Error('Product sync failed');
      return res.json();
    },

    async createStripeCheckout(items, buyer){
      const res = await fetch(GENZ_API_BASE + '/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, buyer })
      });
      if(!res.ok) throw new Error('Could not start Stripe checkout');
      return res.json(); // { url, orderNumber }
    },

    async initiateJazzCash(items, buyer){
      const res = await fetch(GENZ_API_BASE + '/api/jazzcash/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, buyer })
      });
      if(!res.ok) throw new Error('Could not start JazzCash payment');
      return res.json(); // { actionUrl, fields, orderNumber }
    },

    async createOrder(items, buyer, method){
      const res = await fetch(GENZ_API_BASE + '/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, buyer, method })
      });
      if(!res.ok) throw new Error('Could not save order');
      return res.json(); // { orderNumber }
    },

    async createBankOrder(items, buyer){
      return this.createOrder(items, buyer, 'bank');
    },

    async createCODOrder(items, buyer){
      return this.createOrder(items, buyer, 'cod');
    },

    async fetchOrders(){
      const res = await adminFetch('/api/orders');
      if(!res.ok) throw new Error('Could not fetch orders');
      return res.json();
    },

    async updateOrderStatus(orderNumber, status){
      const res = await adminFetch('/api/orders/status', {
        method:'POST',
        body: JSON.stringify({ orderNumber, status })
      });
      if(!res.ok) throw new Error('Could not update order status');
      return res.json();
    },

    async clearLoginRecords(){
      const res = await adminFetch('/api/login-records', { method:'DELETE' });
      if(!res.ok) throw new Error('Could not clear login records');
      return res.json();
    },

    // Builds a hidden form and submits it — used to redirect the browser
    // to JazzCash's hosted payment page with the signed fields attached.
    submitToJazzCash(actionUrl, fields){
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = actionUrl;
      Object.entries(fields).forEach(([key, value]) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = key;
        input.value = value;
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
    }
  };

  // Wrap the products module's save() so every admin add/edit/archive
  // also syncs to the backend — fire-and-forget, with a console warning
  // (not a user-facing error) if the backend isn't reachable, since the
  // change has still succeeded locally.
  if(window.__products && typeof window.__products.save === 'function'){
    const originalSave = window.__products.save;
    window.__products.save = function(...args){
      const result = originalSave.apply(this, args);
      if(getAdminToken()){
        window.__genzBackend.syncProducts(window.__products.get())
          .catch(err => console.warn('Backend product sync failed — change is saved locally only.', err));
      }
      return result;
    };
  }

  // On load, try to replace the local seed catalog with the live one
  // from the backend. If the backend isn't running, this silently no-ops
  // and the site keeps using its bundled default products.
  (async () => {
    try{
      const liveProducts = await window.__genzBackend.fetchProducts();
      if(liveProducts.length && window.__products){
        window.__products.set(liveProducts);
        window.__products.render();
      }
    }catch(err){
      console.warn('Backend not reachable — showing local product catalog.', err);
    }
  })();

  }catch(err){ console.warn('Backend integration setup failed', err); }
