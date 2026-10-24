// Слой доступа к данным.
// Сейчас данные читаются из JSON-файлов. При переходе на базу данных достаточно
// поменять адреса в ENDPOINTS на адреса API (например, /api/cafes/:id/menu),
// которые отдают JSON того же формата, — остальной код сайта менять не нужно.

const API = (() => {
  'use strict';

  const ENDPOINTS = {
    styles: () => 'data/categories.json',   // будущее: /api/category-styles
    cafes:  () => 'data/cafes.json',        // будущее: /api/cafes
    menu:   cafe => cafe.file,              // будущее: `/api/cafes/${cafe.id}/menu`
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

  // null, '', [] — «нет данных»: такие блоки на сайте не показываются
  const present = v => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length);
  const num = v => (present(v) && Number.isFinite(Number(v)) ? Number(v) : null);
  const str = v => (present(v) ? String(v) : null);

  // ───────── общие стили разделов (цвет, тип, рекомендации)

  const FALLBACK_STYLE = {
    id: 'other', name: 'Другое', emoji: '🍽️', kind: 'other',
    colors: ['#f1ebe4', '#c9b6a3'], pairsWith: [], prep: 5,
  };

  async function getStyles() {
    const raw = await getJSON(ENDPOINTS.styles());
    const styles = {};
    ((raw && raw.categories) || []).forEach(c => {
      styles[c.id] = {
        id: String(c.id),
        name: c.name || c.id,
        emoji: c.emoji || FALLBACK_STYLE.emoji,
        kind: c.kind || 'other',
        colors: Array.isArray(c.colors) && c.colors.length === 2 ? c.colors : FALLBACK_STYLE.colors,
        pairsWith: Array.isArray(c.pairs_with) ? c.pairs_with : [],
        prep: num(c.default_prep_min) || FALLBACK_STYLE.prep,
      };
    });
    if (!styles.other) styles.other = FALLBACK_STYLE;
    return styles;
  }

  // ───────── реестр кофеен

  async function getCafes() {
    const raw = (await getJSON(ENDPOINTS.cafes())) || {};
    const brand = raw.brand || {};
    const cafes = (Array.isArray(raw.cafes) ? raw.cafes : [])
      .filter(c => c && c.id && c.file)
      .map(c => ({
        id: String(c.id),
        file: c.file,
        name: str(c.name) || String(c.id),
        logo: str(c.logo),
        address: str(c.address),
        city: str(c.city),
        hours: str(c.hours),
        currency: str(c.currency) || 'KZT',
      }));
    return { brand: { name: str(brand.name) || 'Меню', logo: str(brand.logo) }, cafes };
  }

  // ───────── меню кофейни

  function normalizeCategory(raw, styles, index) {
    const style = styles[raw.id] || styles.other;
    return {
      ...style,
      id: String(raw.id),
      name: str(raw.name) || style.name,
      emoji: str(raw.icon) || style.emoji,
      order: num(raw.order) ?? 1000 + index,
    };
  }

  function normalizeNutrition(n) {
    if (!n || typeof n !== 'object') return null;
    const res = { kcal: num(n.calories), p: num(n.proteins), f: num(n.fats), c: num(n.carbs) };
    return Object.values(res).some(v => v !== null) ? res : null;
  }

  function normalizeItem(raw, index, cats, styles, usedIds) {
    if (!raw || typeof raw !== 'object' || !present(raw.name)) {
      console.warn(`Позиция #${index + 1} пропущена: нет названия`, raw);
      return null;
    }

    // раздел, которого нет в списке кофейни, — добавляем из общих стилей
    let cat = cats.find(c => c.id === raw.category_id);
    if (!cat) {
      const id = styles[raw.category_id] ? raw.category_id : 'other';
      cat = cats.find(c => c.id === id) || normalizeCategory({ id }, styles, cats.length);
      if (!cats.includes(cat)) cats.push(cat);
    }

    const sizes = (Array.isArray(raw.variants) ? raw.variants : [])
      .filter(v => v && num(v.price) !== null)
      .map((v, i) => ({
        id: str(v.variant_id) || String(i),
        label: str(v.measure) || `Вариант ${i + 1}`,
        amount: str(v.measure),
        price: num(v.price),
        nutrition: normalizeNutrition(v.nutrition),
      }));
    if (!sizes.length) {
      console.warn(`Позиция «${raw.name}» пропущена: нет вариантов с ценой`, raw);
      return null;
    }

    // id нужен для заказа; если его нет — берём название
    let id = str(raw.id) || String(raw.name);
    while (usedIds.has(id)) id += '_';
    usedIds.add(id);

    const prep = num(raw.prep_time_min);
    return {
      id,
      cat: cat.id,
      name: String(raw.name),
      desc: str(raw.description),
      image: str(raw.image_url),
      ing: Array.isArray(raw.ingredients) ? raw.ingredients.filter(present).map(String) : [],
      prep,                                    // null — не показываем
      prepEstimate: prep ?? cat.prep,          // для расчёта времени заказа
      special: raw.is_special === true,
      sizes,
      price: sizes[0].price,
    };
  }

  async function getMenu(cafe, styles) {
    const raw = (await getJSON(ENDPOINTS.menu(cafe))) || {};

    const cats = (Array.isArray(raw.categories) ? raw.categories : [])
      .filter(c => c && present(c.id))
      .map((c, i) => normalizeCategory(c, styles, i));

    const usedIds = new Set();
    const items = (Array.isArray(raw.items) ? raw.items : [])
      .map((it, i) => normalizeItem(it, i, cats, styles, usedIds))
      .filter(Boolean);

    cats.sort((a, b) => a.order - b.order);
    return { cafe, currency: cafe.currency, categories: cats, items };
  }

  return { getStyles, getCafes, getMenu, DataError };
})();
