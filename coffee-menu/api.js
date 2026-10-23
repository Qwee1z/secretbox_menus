// Слой доступа к данным.
// Сейчас данные читаются из JSON-файлов. При переходе на базу данных достаточно
// поменять адреса в ENDPOINTS на адреса API (например, /api/cafes/:id/menu),
// которые отдают JSON того же формата, — остальной код сайта менять не нужно.

const API = (() => {
  'use strict';

  const ENDPOINTS = {
    categories: () => 'data/categories.json',   // будущее: /api/categories
    cafes:      () => 'data/cafes.json',        // будущее: /api/cafes
    menu:       cafe => cafe.file,              // будущее: `/api/cafes/${cafe.id}/menu`
  };

  class DataError extends Error {
    constructor(message, url) { super(message); this.url = url; }
  }

  async function getJSON(url) {
    let res;
    try {
      res = await fetch(url, { cache: 'no-cache' });
    } catch {
      throw new DataError('Не удалось загрузить данные. Сайт нужно открывать через локальный сервер (start.cmd), а не двойным кликом по index.html.', url);
    }
    if (!res.ok) throw new DataError(`Файл не найден (${res.status})`, url);
    const text = await res.text();
    if (!text.trim()) return null; // пустой файл — пустое меню
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new DataError(`Ошибка в JSON: ${e.message}`, url);
    }
  }

  // ───────── справочник разделов

  const FALLBACK_CATEGORY = {
    id: 'other', name: 'Другое', emoji: '🍽️', kind: 'other',
    colors: ['#f1ebe4', '#c9b6a3'], pairs_with: [], default_prep_min: 5,
  };

  async function getCategories() {
    const raw = await getJSON(ENDPOINTS.categories());
    const list = (raw && raw.categories) || [];
    if (!list.some(c => c.id === FALLBACK_CATEGORY.id)) list.push(FALLBACK_CATEGORY);
    return list.map(c => ({
      id: String(c.id),
      name: c.name || c.id,
      emoji: c.emoji || '🍽️',
      kind: c.kind || 'other',
      colors: Array.isArray(c.colors) && c.colors.length === 2 ? c.colors : FALLBACK_CATEGORY.colors,
      pairsWith: Array.isArray(c.pairs_with) ? c.pairs_with : [],
      prep: Number(c.default_prep_min) || 5,
      hidden: Boolean(c.hidden),
    }));
  }

  // ───────── кофейни

  async function getCafes() {
    const raw = await getJSON(ENDPOINTS.cafes());
    return ((raw && raw.cafes) || [])
      .filter(c => c && c.id && c.file)
      .map(c => ({ id: String(c.id), file: c.file, name: c.name || null }));
  }

  // ───────── меню кофейни

  const amountOf = s => s.amount
    || (s.size_ml ? `${s.size_ml} мл` : s.weight_g ? `${s.weight_g} г` : null);

  function normalizeItem(raw, index, catsById, usedIds) {
    if (!raw || typeof raw !== 'object' || !raw.name) {
      console.warn(`Позиция #${index + 1} пропущена: нет названия`, raw);
      return null;
    }
    if (raw.available === false) return null;

    const cat = catsById[raw.category] || catsById.other;

    let sizes = null;
    if (Array.isArray(raw.sizes) && raw.sizes.length) {
      sizes = raw.sizes
        .filter(s => s && Number.isFinite(Number(s.price)))
        .map(s => ({
          label: s.label || amountOf(s) || '',
          amount: amountOf(s),
          price: Number(s.price),
          qty: Number(s.size_ml || s.weight_g) || null,
        }));
      // КБЖУ указано для первого размера — для остальных пересчитываем по объёму/весу
      const base = sizes[0] && sizes[0].qty;
      sizes.forEach(s => { s.k = base && s.qty ? s.qty / base : 1; });
      if (!sizes.length) sizes = null;
    }

    const price = sizes ? sizes[0].price : Number(raw.price);
    if (!Number.isFinite(price)) {
      console.warn(`Позиция «${raw.name}» пропущена: нет цены`, raw);
      return null;
    }

    // id нужен для заказа; если его нет — берём название
    let id = String(raw.id || raw.name);
    while (usedIds.has(id)) id += '_';
    usedIds.add(id);

    const n = raw.nutrition;
    const num = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
    const nutrition = n && typeof n === 'object'
      ? { kcal: num(n.kcal), p: num(n.protein), f: num(n.fat), c: num(n.carbs) }
      : null;

    return {
      id,
      cat: cat.id,
      name: String(raw.name),
      short: raw.short || '',
      desc: raw.description || '',
      emoji: raw.emoji || cat.emoji,
      image: raw.image || null,
      badge: raw.badge || null,
      price,
      oldPrice: num(raw.old_price),
      sizes,
      amount: sizes ? null : amountOf(raw),
      nutrition: nutrition && Object.values(nutrition).some(v => v !== null) ? nutrition : null,
      ing: Array.isArray(raw.ingredients) ? raw.ingredients.map(String) : [],
      prep: num(raw.prep_min) || cat.prep,
    };
  }

  async function getMenu(cafe, categories) {
    const raw = (await getJSON(ENDPOINTS.menu(cafe))) || {};
    const catsById = Object.fromEntries(categories.map(c => [c.id, c]));
    const info = raw.cafe || {};
    const usedIds = new Set();

    const items = (Array.isArray(raw.items) ? raw.items : [])
      .map((it, i) => normalizeItem(it, i, catsById, usedIds))
      .filter(Boolean);

    const ids = new Set(items.map(i => i.id));
    const specials = (Array.isArray(raw.specials) ? raw.specials : [])
      .filter(s => s && ids.has(String(s.item)))
      .map(s => ({ label: s.label || 'Сегодня', id: String(s.item) }));

    return {
      cafe: {
        id: cafe.id,
        name: info.name || cafe.name || cafe.id,
        address: info.address || '',
        city: info.city || '',
        hours: info.hours || '',
        logo: info.logo || null,
      },
      currency: raw.currency || 'KZT',
      items,
      specials,
    };
  }

  return { getCategories, getCafes, getMenu, DataError };
})();
