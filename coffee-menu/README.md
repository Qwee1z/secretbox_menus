# Secretbox — меню кофеен

Сайт-меню с заказом. Все данные лежат в JSON — код сайта менять не нужно, чтобы добавить кофейню, позицию или поменять цену.

## Запуск

Дважды кликнуть `start.cmd` (нужен Python) — откроется http://localhost:8000.
Открыть `index.html` напрямую нельзя: браузер не даёт странице, открытой как файл, читать JSON.

## Где какие данные

| Файл | Что внутри | Будущая таблица в БД |
|---|---|---|
| `data/cafes.json` | бренд Secretbox и список кофеен: название, логотип, адрес, валюта, файл меню | `cafes` |
| `cafes/<id>.json` | разделы и позиции меню кофейни (шаблон — `master_coffe.json`) | `categories`, `items`, `variants` |
| `data/categories.json` | общие настройки разделов: цвет карточек, что к чему рекомендовать, время по умолчанию | `category_styles` |
| `data/menu.schema.json` | описание формата меню (подсказки и проверка в VS Code) | — |
| `pictures/logos/` | логотипы | — |
| `pictures/items/<id кофейни>/` | фото позиций | — |

Кофейня открывается по адресу `?cafe=<id>`. Без параметра — начальный экран Secretbox со списком кофеен.

## Правило `null`

Если у позиции чего-то нет (описание, состав, объём, КБЖУ, время приготовления) — пишите `null`. Блок под это значение на сайте не создаётся.

## Фото позиций

У каждой позиции уже прописан путь в `image_url`, например:

```
pictures/items/master_coffe/item_latte.jpg
```

Достаточно положить файл с таким именем в эту папку — фото появится. Пока файла нет, показывается иконка раздела.

## Формат меню (`cafes/<id>.json`)

```json
{
  "categories": [
    { "id": "coffee", "name": "Кофе", "icon": "☕", "order": 1 }
  ],
  "items": [
    {
      "id": "item_latte",
      "category_id": "coffee",
      "name": "Латте",
      "image_url": "pictures/items/master_coffe/item_latte.jpg",
      "description": null,
      "ingredients": null,
      "prep_time_min": 5,
      "is_special": false,
      "variants": [
        {
          "variant_id": "var_latte_std",
          "measure": "400 мл",
          "price": 1190,
          "nutrition": null
        }
      ]
    }
  ]
}
```

- `category_id` — один из разделов файла. Цвет и рекомендации берутся из `data/categories.json` по тому же id (`coffee`, `tea`, `cocoa`, `cold_drinks`, `pastry`, `desserts`, `breakfast`, `snacks`, `hot_meals`, `combo`).
- `is_special: true` — позиция попадает в блок «Сегодня в меню».
- `variants` — если вариантов несколько (например, 250 / 350 / 450 мл), на сайте появляется выбор, у каждого своя цена и КБЖУ.
- `id` позиции не меняйте после запуска — по нему хранятся заказы гостей.

## Как добавить кофейню

1. Создать `cafes/new_cafe.json` (можно пустым — будет «Меню пока пустое»).
2. Положить логотип в `pictures/logos/`.
3. Добавить кофейню в `data/cafes.json`:
   ```json
   {
     "id": "new_cafe",
     "name": "New Cafe",
     "file": "cafes/new_cafe.json",
     "logo": "pictures/logos/logo_new.png",
     "address": null,
     "city": null,
     "hours": null,
     "currency": "KZT"
   }
   ```

## Переход на базу данных

Весь доступ к данным — в `api.js` (`getCafes`, `getMenu`, `getStyles`). Чтобы перейти на БД, нужен сервер, который отдаёт JSON того же формата, и замена адресов в `ENDPOINTS`:

```js
cafes:  () => '/api/cafes',
menu:   cafe => `/api/cafes/${cafe.id}/menu`,
styles: () => '/api/category-styles',
```

`app.js` работает только с уже нормализованными данными и при этом не меняется.
