# Как участвовать в проекте / Contributing

Русский ниже, English below.

---

## На русском

### Issues

- **Баг**: используйте шаблон «Bug report». Обязательно: версия OpenWrt,
  модель роутера, версия темы, шаги воспроизведения, скриншот.
- **Фича**: шаблон «Feature request». Опишите задачу, а не решение
  («хочу быстро переключать VPN» — да; «добавьте кнопку сюда» — нет).
- Поищите сначала существующие issues — возможно, уже обсуждается.

### Pull requests

1. Один PR — одна логическая изменение (фикс бага или одна фича).
2. PR в `main`. Ветку называйте `fix/…` или `feature/…`.
3. Проверьте на живом роутере: страницы System, Network → Firewall,
   Status → Overview, страница с формой (Save & Apply), мобильная ширина
   (≤ 992 px). Консоль браузера без красных ошибок.
4. CSS-изменения — через CSS-переменные из `:root` темы, без хардкода
   цветов. JS-модули — в `htdocs/luci-static/resources/dv-*.js`, стили
   модулей — в `htdocs/luci-static/darkvibe/css/dv-*.css`.
5. Если меняете поведение — обновите README.

Лицензия MIT: отправляя код, вы соглашаетесь с ней.

---

## English

### Issues

- **Bug**: use the «Bug report» template. Required: OpenWrt version, router
  model, theme version, reproduction steps, screenshot.
- **Feature**: use the «Feature request» template. Describe the problem, not
  the solution.
- Search existing issues first.

### Pull requests

1. One PR — one logical change (a bugfix or a single feature).
2. Target `main`. Branch naming: `fix/…` or `feature/…`.
3. Test on a live router: System, Network → Firewall, Status → Overview, a
  form page (Save & Apply), mobile width (≤ 992 px). No console errors.
4. Use the theme's CSS custom properties — no hardcoded colors. JS modules
   live in `htdocs/luci-static/resources/dv-*.js`, their styles in
   `htdocs/luci-static/darkvibe/css/dv-*.css`.
5. Update the README when behavior changes.

MIT license: by submitting code you agree to it.
