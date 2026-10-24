(() => {
  'use strict';

  // Заполняется после загрузки данных (см. init)
  let STYLES = {};        // общие стили разделов (data/categories.json)
  let BRAND = null;       // { name, logo } — для экрана выбора кофейни
  let MENU = null;        // { cafe, currency, categories, items }
  let CATS = {};          // id раздела → раздел текущей кофейни
  let BY_ID = {};         // id позиции → позиция
  let STORAGE_KEY = '';
  let money = null;

  const state = {
    cat: 'all',
    order: {},            // { 'id:variantIndex': qty }
    dineIn: 'hall',       // 'hall' | 'togo'
    when: 'asap',         // 'asap' | минуты
    stack: [],            // открытые окна: { type: 'product', id, size } | { type: 'order' }
  };

  const $ = sel => document.querySelector(sel);
  const overlay = $('#overlay');
  const sheet = $('#sheet');
  const cartBar = $('#cartBar');

  // ───────── helpers

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ESC[ch]);

  const fmt = n => money.format(Math.round(n));
  const keyOf = (id, size = 0) => `${encodeURIComponent(id)}:${size}`;
  const parseKey = key => {
    const [id, size] = key.split(':');
    return { item: BY_ID[decodeURIComponent(id)], size: Number(size) || 0 };
  };
  const priceOf = (item, size = 0) => item.sizes[size].price;
  const minPrice = item => Math.min(...item.sizes.map(s => s.price));
  const catOf = item => CATS[item.cat] || STYLES.other;
  const isDrink = item => catOf(item).kind === 'drink';
  const qtyOf = key => state.order[key] || 0;
  const priceLabel = item => (item.sizes.length > 1 ? 'от ' : '') + fmt(minPrice(item));

  const SPECIAL_LABEL = { drink: 'Напиток дня', sweet: 'Десерт дня', set: 'Комбо дня' };
  const specialLabel = item => SPECIAL_LABEL[catOf(item).kind] || 'Блюдо дня';

  function makeMoney(currency) {
    try {
      return new Intl.NumberFormat('ru-RU', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 });
    } catch {
      return { format: n => `${n.toLocaleString('ru-RU')} ${currency}` };
    }
  }

  function loadOrder() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; }
  }
  function saveOrder() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.order)); } catch { /* приватный режим */ }
  }

  // позиции, которых больше нет в меню, из заказа выпадают; цены всегда актуальные из данных
  function orderLines() {
    return Object.entries(state.order)
      .map(([key, qty]) => ({ key, qty, ...parseKey(key) }))
      .filter(l => l.qty > 0 && l.item && l.item.sizes[l.size]);
  }
  const orderCount = () => orderLines().reduce((s, l) => s + l.qty, 0);
  const orderTotal = () => orderLines().reduce((s, l) => s + priceOf(l.item, l.size) * l.qty, 0);

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  // ───────── шаблоны

  // Иконка раздела на цветном фоне; если по ссылке image_url есть фото — оно ложится сверху.
  // Фото ещё нет — img сам себя убирает, и остаётся иконка.
  function pic(item, cls = '') {
    const cat = catOf(item);
    const [c1, c2] = cat.colors;
    return `
      <div class="pic ${cls}" style="--c1:${esc(c1)};--c2:${esc(c2)}">
        <span>${esc(cat.emoji)}</span>
        ${item.image ? `<img src="${esc(item.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
      </div>`;
  }

  const BEAN_MARK = `
    <svg class="logo-mark" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="23" fill="var(--accent)" stroke="none"/>
      <ellipse cx="24" cy="24" rx="9" ry="13" fill="#fff8f0" stroke="none" transform="rotate(30 24 24)"/>
      <path d="M19 14c5 5 5 15 10 20" stroke="var(--accent)" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    </svg>`;

  function logo(src, name, cls) {
    return src
      ? `<img class="${cls}" src="${esc(src)}" alt="${esc(name)}">`
      : `<span class="${cls} logo-letter">${esc(name.trim().charAt(0).toUpperCase() || '☕')}</span>`;
  }

  // Кнопка «В заказ» или счётчик. Обновляется через updateSlots() без перерисовки карточек.
  function control(key, variant) {
    const q = qtyOf(key);
    const cls = variant === 'card' ? '' : variant; // «card» — уже класс карточки, на кнопку его не вешаем
    const { item, size } = parseKey(key);
    if (!q) {
      const label = variant === 'big'
        ? `Добавить в заказ <span class="btn-sub">${fmt(priceOf(item, size))}</span>`
        : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>В заказ`;
      return `<button class="btn-add ${cls}" type="button" data-add="${esc(key)}">${label}</button>`;
    }
    return `
      <div class="stepper ${cls}">
        <button type="button" data-dec="${esc(key)}" aria-label="Убрать одну">−</button>
        <span>${variant === 'big' ? `${q} в заказе` : q}</span>
        <button type="button" data-inc="${esc(key)}" aria-label="Добавить ещё">+</button>
      </div>`;
  }
  const slot = (key, variant) => `<div class="slot" data-slot="${esc(key)}" data-variant="${variant}">${control(key, variant)}</div>`;

  function card(item) {
    return `
      <article class="card" data-open="${esc(item.id)}" tabindex="0" aria-label="${esc(item.name)}">
        <div class="card-pic">${pic(item)}</div>
        <div class="card-body">
          <h3 class="card-title">${esc(item.name)}</h3>
          ${item.desc ? `<p class="card-short">${esc(item.desc)}</p>` : ''}
          <div class="card-price"><b>${priceLabel(item)}</b></div>
          ${slot(keyOf(item.id), 'card')}
        </div>
      </article>`;
  }

  // ───────── шапка

  function renderHeader(cafe, canSwitch) {
    const name = cafe ? cafe.name : BRAND.name;
    const addr = cafe && (cafe.address || cafe.city);
    const sub = cafe ? [cafe.address && cafe.city, cafe.hours].filter(Boolean).join(' · ') : '';
    const mapQuery = cafe ? encodeURIComponent([cafe.city, cafe.address].filter(Boolean).join(', ')) : '';
    document.title = cafe ? `${cafe.name} — меню` : BRAND.name;

    $('#topbar').innerHTML = `
      ${addr ? `
        <a class="address" href="https://2gis.kz/search/${mapQuery}" target="_blank" rel="noopener" title="Открыть на карте">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.6"/></svg>
          <span class="address-text">
            <b>${esc(cafe.address || cafe.city)}</b>
            ${sub ? `<small>${esc(sub)}</small>` : ''}
          </span>
        </a>` : '<span></span>'}

      <a class="logo" href="${canSwitch ? './' : '#'}" ${canSwitch ? 'title="Выбрать другую кофейню"' : ''}>
        ${cafe ? logo(cafe.logo, name, 'logo-mark') : BEAN_MARK}
        <span class="logo-text">${esc(name)}</span>
      </a>

      <button class="avatar" type="button" aria-label="Профиль">
        <img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%23f6d7b8'/><stop offset='1' stop-color='%23d79a63'/></linearGradient></defs><rect width='64' height='64' fill='url(%23g)'/><circle cx='32' cy='26' r='11' fill='%23fff8f0'/><path d='M12 60c2-12 10-18 20-18s18 6 20 18' fill='%23fff8f0'/></svg>" alt="">
      </button>`;
  }

  // ───────── главный экран

  function renderToday() {
    const specials = MENU.items.filter(i => i.special);
    $('#today').hidden = !specials.length;
    if (!specials.length) return;

    $('#todayDate').textContent = new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

    $('#specials').innerHTML = specials.map(item => `
      <article class="special" data-open="${esc(item.id)}" tabindex="0">
        <div class="special-pic">${pic(item)}</div>
        <div class="special-body">
          <span class="special-label">${specialLabel(item)}</span>
          <h3>${esc(item.name)}</h3>
          ${item.desc ? `<p>${esc(item.desc)}</p>` : ''}
          <div class="special-foot">
            <div class="card-price"><b>${priceLabel(item)}</b></div>
            ${slot(keyOf(item.id), 'card')}
          </div>
        </div>
      </article>`).join('');
  }

  // в ленте — только разделы, в которых есть позиции
  function menuCategories() {
    const used = new Set(MENU.items.map(i => i.cat));
    return MENU.categories.filter(c => used.has(c.id));
  }

  function renderTabs() {
    const cats = menuCategories();
    $('#tabsWrap').hidden = cats.length === 0;
    if (!cats.length) return;
    if (state.cat !== 'all' && !cats.some(c => c.id === state.cat)) state.cat = 'all';

    const tabs = $('#tabs');
    const all = cats.length > 1 ? [{ id: 'all', name: 'Всё меню', emoji: '✨' }, ...cats] : cats;
    if (cats.length === 1) state.cat = cats[0].id;

    tabs.innerHTML = all.map(c => `
      <button class="tab ${c.id === state.cat ? 'active' : ''}" type="button" role="tab"
              aria-selected="${c.id === state.cat}" data-cat="${esc(c.id)}">
        <span class="tab-emoji">${esc(c.emoji)}</span>${esc(c.name)}
      </button>`).join('');
    const active = tabs.querySelector('.active');
    if (active) {
      tabs.scrollTo({ left: active.offsetLeft - (tabs.clientWidth - active.offsetWidth) / 2, behavior: 'smooth' });
    }
  }

  function renderMenu() {
    const cats = menuCategories();
    if (!cats.length) {
      $('#menu').innerHTML = `
        <div class="empty">
          <div class="empty-emoji">📋</div>
          <p>Меню пока пустое</p>
          <small>Скоро здесь появятся напитки и блюда</small>
        </div>`;
      return;
    }

    const groups = state.cat === 'all' ? cats : cats.filter(c => c.id === state.cat);
    $('#menu').innerHTML = groups.map(c => {
      const items = MENU.items.filter(i => i.cat === c.id);
      return `
        <div class="group">
          <h2 class="group-title">${esc(c.name)} <span>${items.length}</span></h2>
          <div class="grid">${items.map(card).join('')}</div>
        </div>`;
    }).join('');
  }

  function renderCartBar() {
    const count = orderCount();
    cartBar.hidden = count === 0;
    if (!count) return;
    cartBar.innerHTML = `
      <span class="cart-bar-left">
        <span class="cart-bar-count">${count}</span>
        Перейти к заказу
      </span>
      <b>${fmt(orderTotal())}</b>`;
  }

  function updateSlots() {
    document.querySelectorAll('.slot').forEach(el => {
      el.innerHTML = control(el.dataset.slot, el.dataset.variant);
    });
  }

  // ───────── рекомендации: какие разделы к чему подходят — в data/categories.json (pairs_with)

  function recommendationsFor(item) {
    const cats = catOf(item).pairsWith;
    // стабильное «случайное» перемешивание, чтобы у каждой позиции был свой набор
    const hash = s => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
    return MENU.items
      .filter(i => cats.includes(i.cat) && i.id !== item.id)
      .sort((a, b) => hash(item.id + a.id) - hash(item.id + b.id))
      .slice(0, 8);
  }

  // ───────── окно позиции. Блок создаётся только если для него есть данные (не null)

  function productView(entry) {
    const item = BY_ID[entry.id];
    const size = item.sizes[entry.size] ? entry.size : 0;
    const v = item.sizes[size];
    const n = v.nutrition;
    const drink = isDrink(item);
    const recs = recommendationsFor(item);
    const r = x => String(x).replace('.', ',');

    const meta = [
      v.amount && esc(v.amount),
      item.prep !== null && `~${item.prep} мин`,
      n && n.kcal !== null && `${r(n.kcal)} ккал`,
    ].filter(Boolean);

    const nutri = n ? [[n.kcal, 'ккал'], [n.p, 'белки, г'], [n.f, 'жиры, г'], [n.c, 'углеводы, г']]
      .filter(([x]) => x !== null) : [];

    const facts = [
      v.amount && [drink ? 'Объём' : 'Вес', esc(v.amount)],
      item.sizes.length > 1 && item.sizes.every(s => s.amount) && ['Варианты', item.sizes.map(s => esc(s.amount)).join(' / ')],
      item.prep !== null && ['Время приготовления', `~${item.prep} мин`],
    ].filter(Boolean);

    return `
      <div class="pm">
        <div class="pm-hero">${pic(item, 'xl')}</div>

        <div class="pm-body">
          <h2 class="pm-title">${esc(item.name)}</h2>
          ${meta.length ? `<div class="pm-meta">${meta.map(m => `<span>${m}</span>`).join('')}</div>` : ''}

          ${item.sizes.length > 1 ? `
            <div class="sizes" role="radiogroup" aria-label="Вариант">
              ${item.sizes.map((s, i) => `
                <button type="button" class="size ${i === size ? 'active' : ''}" data-size="${i}" role="radio" aria-checked="${i === size}">
                  <b>${esc(s.label)}</b><small>${fmt(s.price)}</small>
                </button>`).join('')}
            </div>` : ''}

          <div class="pm-buy">
            <div class="pm-price"><b>${fmt(v.price)}</b></div>
            ${slot(keyOf(item.id, size), 'big')}
          </div>

          ${item.desc ? `<p class="pm-desc">${esc(item.desc)}</p>` : ''}

          ${nutri.length ? `
            <h3 class="pm-h">Пищевая ценность ${v.amount ? `<small>на ${esc(v.amount)}</small>` : ''}</h3>
            <div class="nutri" style="--cols:${nutri.length}">
              ${nutri.map(([x, label]) => `<div><b>${r(x)}</b><small>${label}</small></div>`).join('')}
            </div>` : ''}

          ${item.ing.length ? `
            <h3 class="pm-h">Состав</h3>
            <div class="chips">${item.ing.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}

          ${facts.length ? `
            <dl class="facts">
              ${facts.map(([dt, dd]) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`).join('')}
            </dl>` : ''}

          ${recs.length ? `
            <h3 class="pm-h rec-title">${drink || catOf(item).kind === 'set' ? 'К этому напитку возьмите' : 'К этому подойдёт'}</h3>
            <div class="rec-row">${recs.map(card).join('')}</div>` : ''}
        </div>
      </div>`;
  }

  // ───────── окно заказа

  function estimateMinutes() {
    const lines = orderLines();
    if (!lines.length) return 0;
    const maxPrep = Math.max(...lines.map(l => l.item.prepEstimate));
    const qty = lines.reduce((s, l) => s + l.qty, 0);
    const raw = maxPrep + Math.min(15, (qty - 1) * 2);
    return Math.max(5, Math.ceil(raw / 5) * 5);
  }

  const clock = mins => new Date(Date.now() + mins * 60000)
    .toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  function timeOptions() {
    const est = estimateMinutes();
    const opts = [{ id: 'asap', title: 'Побыстрее', sub: `~${est} мин · к ${clock(est)}` }];
    [[30, 'Через 30 мин'], [60, 'Через 1 час'], [90, 'Через 1,5 часа'], [120, 'Через 2 часа']]
      .forEach(([m, title]) => {
        if (m >= est + 5) opts.push({ id: String(m), title, sub: `к ${clock(m)}` });
      });
    return opts;
  }

  function orderView() {
    const lines = orderLines();
    if (!lines.length) {
      return `
        <div class="om">
          <h2 class="om-title">Ваш заказ</h2>
          <div class="empty">
            <div class="empty-emoji">🧾</div>
            <p>В заказе пока пусто</p>
            <small>Добавьте что-нибудь вкусное из меню</small>
            <button class="btn-primary" type="button" data-close>Вернуться в меню</button>
          </div>
        </div>`;
    }

    const opts = timeOptions();
    if (!opts.some(o => o.id === state.when)) state.when = 'asap';
    const count = orderCount();

    return `
      <div class="om">
        <div class="om-head">
          <h2 class="om-title">Ваш заказ</h2>
          <button class="link" type="button" data-clear>Очистить</button>
        </div>

        <ul class="lines">
          ${lines.map(l => {
            const amount = l.item.sizes[l.size].amount;
            return `
              <li class="line">
                <div class="line-pic" data-open="${esc(l.item.id)}" data-open-size="${l.size}">${pic(l.item)}</div>
                <div class="line-info" data-open="${esc(l.item.id)}" data-open-size="${l.size}">
                  <b>${esc(l.item.name)}</b>
                  ${amount ? `<small>${esc(amount)}</small>` : ''}
                  <small>${fmt(priceOf(l.item, l.size))} × ${l.qty}</small>
                </div>
                <div class="line-right">
                  <b>${fmt(priceOf(l.item, l.size) * l.qty)}</b>
                  ${control(l.key, 'mini')}
                </div>
              </li>`;
          }).join('')}
        </ul>

        <h3 class="pm-h">Где будете есть?</h3>
        <div class="segmented">
          <button type="button" class="${state.dineIn === 'hall' ? 'active' : ''}" data-dine="hall">🪑 В зале</button>
          <button type="button" class="${state.dineIn === 'togo' ? 'active' : ''}" data-dine="togo">🛍️ С собой</button>
        </div>

        <h3 class="pm-h">Когда приготовить?</h3>
        <div class="times">
          ${opts.map(o => `
            <button type="button" class="time ${o.id === state.when ? 'active' : ''}" data-when="${o.id}">
              <b>${o.title}</b><small>${o.sub}</small>
            </button>`).join('')}
        </div>
        <p class="hint">Время рассчитано по самой долгой позиции в заказе и загрузке кухни.</p>

        <div class="summary">
          <div><span>${count} ${plural(count, 'позиция', 'позиции', 'позиций')}</span><span>${fmt(orderTotal())}</span></div>
          <div class="total"><span>Итого</span><span>${fmt(orderTotal())}</span></div>
        </div>

        <div class="pay-wrap">
          <button class="btn-primary pay" type="button">Оплатить · ${fmt(orderTotal())}</button>
        </div>
      </div>`;
  }

  // ───────── модальные окна (со стеком и кнопкой «Назад» браузера)

  function renderModal(resetScroll) {
    const top = state.stack[state.stack.length - 1];
    if (!top) {
      overlay.classList.remove('open');
      document.body.classList.remove('locked');
      setTimeout(() => { if (!state.stack.length) { overlay.hidden = true; sheet.innerHTML = ''; } }, 250);
      return;
    }

    const scroller = sheet.querySelector('.sheet-scroll');
    const prevScroll = scroller && !resetScroll ? scroller.scrollTop : 0;
    const canBack = state.stack.length > 1;

    sheet.className = `sheet ${top.type}`;
    sheet.setAttribute('aria-label', top.type === 'order' ? 'Ваш заказ' : BY_ID[top.id].name);
    sheet.innerHTML = `
      <div class="sheet-controls">
        ${canBack ? `<button class="round-btn" type="button" data-back aria-label="Назад">
          <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>` : '<span></span>'}
        <button class="round-btn" type="button" data-close aria-label="Закрыть">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="sheet-scroll">${top.type === 'order' ? orderView() : productView(top)}</div>`;

    sheet.querySelector('.sheet-scroll').scrollTop = prevScroll;
    if (resetScroll) {
      sheet.classList.remove('swap');
      void sheet.offsetWidth;
      sheet.classList.add('swap');
    }

    if (overlay.hidden) {
      overlay.hidden = false;
      requestAnimationFrame(() => overlay.classList.add('open'));
    } else {
      overlay.classList.add('open');
    }
    document.body.classList.add('locked');
  }

  function pushModal(entry) {
    if (entry.type === 'product' && !BY_ID[entry.id]) return;
    state.stack.push(entry);
    history.pushState({ depth: state.stack.length }, '');
    renderModal(true);
  }

  function closeAll() {
    if (state.stack.length) history.go(-state.stack.length);
  }

  window.addEventListener('popstate', e => {
    const depth = (e.state && e.state.depth) || 0;
    if (depth < state.stack.length) {
      state.stack.length = depth;
      renderModal(true);
    }
  });

  // ───────── изменение заказа

  function changeQty(key, delta) {
    const q = Math.max(0, qtyOf(key) + delta);
    if (q) state.order[key] = q; else delete state.order[key];
    saveOrder();
    updateSlots();
    renderCartBar();
    if (delta > 0) {
      cartBar.classList.remove('bump');
      void cartBar.offsetWidth;
      cartBar.classList.add('bump');
    }
    const top = state.stack[state.stack.length - 1];
    if (top && top.type === 'order') renderModal(false);
  }

  // ───────── события

  document.addEventListener('click', e => {
    if (!MENU) return;
    if (e.target === overlay) { closeAll(); return; }

    const t = e.target.closest(
      '[data-add],[data-inc],[data-dec],[data-open],[data-cat],[data-size],[data-close],[data-back],[data-order],[data-clear],[data-dine],[data-when]'
    );
    if (!t) return;
    const d = t.dataset;

    if (d.add) changeQty(d.add, 1);
    else if (d.inc) changeQty(d.inc, 1);
    else if (d.dec) changeQty(d.dec, -1);
    else if (d.open) pushModal({ type: 'product', id: d.open, size: Number(d.openSize) || 0 });
    else if (d.cat) {
      state.cat = d.cat;
      renderTabs();
      renderMenu();
      const nav = $('#tabsWrap');
      const top = $('#menu').getBoundingClientRect().top + window.scrollY - nav.offsetHeight - 8;
      if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
    }
    else if (d.size !== undefined) {
      const top = state.stack[state.stack.length - 1];
      top.size = Number(d.size);
      renderModal(false);
    }
    else if (d.close !== undefined) closeAll();
    else if (d.back !== undefined) history.back();
    else if (d.order !== undefined) pushModal({ type: 'order' });
    else if (d.clear !== undefined) {
      state.order = {};
      saveOrder();
      updateSlots();
      renderCartBar();
      renderModal(false);
    }
    else if (d.dine) { state.dineIn = d.dine; renderModal(false); }
    else if (d.when) { state.when = d.when; renderModal(false); }
  });

  // карточки открываются и с клавиатуры
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.stack.length) { closeAll(); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-open][tabindex]')) {
      e.preventDefault();
      e.target.click();
    }
  });

  // тень у ленты разделов, когда она прилипла к верху
  const tabsWrap = $('#tabsWrap');
  new IntersectionObserver(([en]) => tabsWrap.classList.toggle('stuck', en.intersectionRatio < 1),
    { threshold: [1], rootMargin: '-1px 0px 0px 0px' }).observe(tabsWrap);

  // ───────── выбор кофейни и ошибки

  function showScreen(html) {
    $('#today').hidden = true;
    $('#tabsWrap').hidden = true;
    $('#menu').hidden = true;
    const screen = $('#screen');
    screen.hidden = false;
    screen.innerHTML = html;
  }

  async function renderPicker(cafes) {
    renderHeader(null, false);

    if (!cafes.length) {
      showScreen(`
        <div class="empty">
          <p>Кофеен пока нет</p>
          <small>Добавьте кофейню в data/cafes.json</small>
        </div>`);
      return;
    }

    // подгружаем меню, чтобы показать число позиций
    const menus = await Promise.allSettled(cafes.map(c => API.getMenu(c, STYLES)));
    showScreen(`
      <h2 class="screen-title">Выберите кофейню</h2>
      <div class="cafes">
        ${cafes.map((c, i) => {
          const res = menus[i];
          const m = res.status === 'fulfilled' ? res.value : null;
          const where = [c.city, c.address].filter(Boolean).join(', ');
          const count = m ? m.items.length : 0;
          const status = !m ? 'Ошибка в данных меню'
            : count ? `${count} ${plural(count, 'позиция', 'позиции', 'позиций')}` : 'Меню пока пустое';
          return `
            <a class="cafe-card ${m ? '' : 'broken'}" href="?cafe=${encodeURIComponent(c.id)}">
              ${logo(c.logo, c.name, 'cafe-logo')}
              <span class="cafe-info">
                <b>${esc(c.name)}</b>
                ${where ? `<small>${esc(where)}</small>` : ''}
                <small class="cafe-status">${esc(status)}</small>
              </span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
            </a>`;
        }).join('')}
      </div>`);
  }

  function renderError(err) {
    console.error(err);
    if (BRAND) renderHeader(null, false);
    showScreen(`
      <div class="empty error">
        <div class="empty-emoji">⚠️</div>
        <p>Не получилось загрузить меню</p>
        <small>${esc(err.message)}</small>
        ${err.url ? `<code>${esc(err.url)}</code>` : ''}
      </div>`);
  }

  // ───────── запуск

  function startMenu(canSwitch) {
    CATS = Object.fromEntries(MENU.categories.map(c => [c.id, c]));
    BY_ID = Object.fromEntries(MENU.items.map(i => [i.id, i]));
    money = makeMoney(MENU.currency);
    STORAGE_KEY = `order:${MENU.cafe.id}`;
    state.order = loadOrder();

    renderHeader(MENU.cafe, canSwitch);
    renderToday();
    renderTabs();
    renderMenu();
    renderCartBar();
  }

  async function init() {
    // если страницу обновили с открытым окном — сбрасываем состояние истории
    if (history.state && history.state.depth) history.replaceState(null, '');

    try {
      const [styles, { brand, cafes }] = await Promise.all([API.getStyles(), API.getCafes()]);
      STYLES = styles;
      BRAND = brand;

      const wanted = new URLSearchParams(location.search).get('cafe');
      const cafe = cafes.find(c => c.id === wanted) || (cafes.length === 1 ? cafes[0] : null);
      if (!cafe) return renderPicker(cafes);

      MENU = await API.getMenu(cafe, styles);
      startMenu(cafes.length > 1);
    } catch (err) {
      renderError(err);
    }
  }

  init();
})();
