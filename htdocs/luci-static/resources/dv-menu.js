'use strict';
'require baseclass';
'require ui';
'require rpc';

/**
 * DarkVibe — UX-модуль меню (ТЗ-UX-volna1: п.4 Ctrl+K, п.8 избранное, п.9 статус Морока).
 *
 * Тема обязана работать без этого модуля: все интеграции с menu-darkvibe.js
 * построены на защищённых опциональных вызовах вида
 *   if (window.DVMenu && typeof window.DVMenu.xxx === 'function') ...
 * и наоборот — модуль самодостаточно лечит отсутствие хуков (перестраховка
 * на случай гонки загрузки модулей).
 *
 * API публикуем в window.DVMenu в момент исполнения модуля, чтобы хуки
 * menu-darkvibe.js успели его найти даже при медленной загрузке этого файла.
 */

/* --------------------------------------------------------------------------
 * Константы
 * ------------------------------------------------------------------------ */

const DV_FAV_KEY = 'dv-fav';          /* localStorage: массив {path, title} */
const DV_FAV_MAX = 8;                 /* максимум пунктов избранного, свежие сверху */

const MOROK_MENU_PATH = '/admin/services/morok'; /* href пункта «Морок» в меню */
const MOROK_POLL_MS = 30000;          /* период опроса ubus morok → status */
const MOROK_PROBE_TIMEOUT = 8000;     /* таймаут одного ubus-вызова */

/* --------------------------------------------------------------------------
 * ubus-RPC. Декларации на верхнем уровне модуля — это только описатели
 * вызовов, сами запросы выполняются при обращении к функциям.
 * ------------------------------------------------------------------------ */

const callMorokStatus = rpc.declare({ object: 'morok', method: 'status' });
const callMorokNodes = rpc.declare({ object: 'morok', method: 'nodes' });

/* --------------------------------------------------------------------------
 * Inline-иконки (стиль lucide, как в menu-darkvibe.js)
 * ------------------------------------------------------------------------ */

const ICON_STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
const ICON_STAR_FILL = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
const ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';

/* --------------------------------------------------------------------------
 * Мелкие утилиты
 * ------------------------------------------------------------------------ */

/* Ограничение промиса по времени: reject('timeout') через ms */
function withTimeout(promise, ms) {
	return new Promise(function(resolve, reject) {
		var timer = setTimeout(function() {
			reject(new Error('timeout'));
		}, ms);

		promise.then(function(value) {
			clearTimeout(timer);
			resolve(value);
		}, function(err) {
			clearTimeout(timer);
			reject(err);
		});
	});
}

/* Чтение избранного; любая битая запись трактуется как пустой список */
function readFavorites() {
	try {
		var raw = localStorage.getItem(DV_FAV_KEY);
		var list = raw ? JSON.parse(raw) : [];
		return Array.isArray(list) ? list.filter(function(f) {
			return f && typeof f.path === 'string' && typeof f.title === 'string';
		}) : [];
	} catch (e) {
		return [];
	}
}

function writeFavorites(list) {
	try {
		localStorage.setItem(DV_FAV_KEY, JSON.stringify(list));
	} catch (e) { /* localStorage может быть недоступен — фича деградирует молча */ }
}

/* Текущий путь страницы в формате 'admin/services/morok' */
function currentPath() {
	return (L.env.requestpath || []).join('/');
}

/* --------------------------------------------------------------------------
 * П.4 — индекс меню для палитры Ctrl+K.
 *
 * ВЫБРАННЫЙ ВАРИАНТ: DOM-проход по #mainmenu после рендера меню.
 * Почему не дерево из ui.menu.load(): menu-darkvibe.js держит дерево в
 * Дерево меню получаем из menu-darkvibe.js через защищённый хук
 * window.DVMenu.setMenuTree(tree) в render(): так индекс покрывает ВСЕ
 * разделы со всех страниц (сайдбар темы рендерит только активную ветку),
 * включая детей «Морока» — ТЗ, п.4, требует их в индексе.
 * Подпись в ТЗ «тема имеет к ним прямой доступ» подтверждает этот вариант.
 *
 * Запасной вариант (если хука нет — тема без правок menu-darkvibe.js):
 * DOM-проход по #mainmenu после рендера. Он даёт только активный раздел,
 * поэтому является фолбэком, а не основным путём. Индекс перестраивается
 * MutationObserver'ом при смене меню.
 *
 * Ограничение обоих вариантов: ищем по отображаемому (переведённому)
 * названию пункта; английский оригинал в дереве недоступен без связки
 * «перевод ↔ оригинал». Отмечено в отчёте как риск.
 * ------------------------------------------------------------------------ */

var menuTree = null;      /* дерево меню из хука menu-darkvibe.js */
var menuIndex = [];
var menuIndexDirty = true;

/* Индекс из дерева: разделы первого уровня — подписи, страницы второго
 * уровня — цели, дети третьего уровня (табы, у Морока — Nodes/Rules/…) —
 * тоже цели с подписью родительской страницы. Глубже не идём:
 * renderMainMenu/renderTabMenu рендерят именно эти уровни. */
function buildIndexFromTree(tree) {
	var index = [];

	ui.menu.getChildren(tree).forEach(function(section) {
		var sectionTitle = _(section.title);

		ui.menu.getChildren(section).forEach(function(page) {
			index.push({
				title: _(page.title),
				href: L.url(section.name, page.name),
				section: sectionTitle
			});

			ui.menu.getChildren(page).forEach(function(child) {
				index.push({
					title: _(child.title),
					href: L.url(section.name, page.name, child.name),
					section: _(page.title)
				});
			});
		});
	});

	return index;
}

/* Фолбэк: DOM-проход по отрендеренному сайдбару (только активный раздел) */
function buildIndexFromDom() {
	var index = [];

	document.querySelectorAll('#mainmenu > ul.nav > li').forEach(function(li) {
		var top = li.querySelector(':scope > a');
		if (!top)
			return;

		var section = (li.querySelector(':scope > a .menu-text') || top).textContent.trim();
		var submenu = li.querySelector(':scope > ul.slide-menu');

		if (!submenu) {
			/* Редкий случай: раздел первого уровня без детей — включаем как есть */
			index.push({ title: top.textContent.trim(), href: top.getAttribute('href'), section: '' });
			return;
		}

		/* Ссылка раздела первого уровня — раскрывалка подменю, не страница:
		 * в индекс не включаем, берём из неё только подпись раздела */
		submenu.querySelectorAll(':scope > li > a').forEach(function(a) {
			index.push({ title: a.textContent.trim(), href: a.getAttribute('href'), section: section });
		});
	});

	return index;
}

/* Приём дерева меню из хука menu-darkvibe.js (вызывается из render()) */
function setMenuTree(tree) {
	if (!tree)
		return;

	menuTree = tree;
	menuIndexDirty = true;
}

function buildMenuIndex() {
	return menuTree ? buildIndexFromTree(menuTree) : buildIndexFromDom();
}

function ensureMenuIndex() {
	if (!menuIndexDirty && menuIndex.length)
		return menuIndex;

	menuIndex = buildMenuIndex();
	menuIndexDirty = false;
	return menuIndex;
}

/* Скоринг: начало названия > подстрока в названии > подстрока в пути.
 * Регистронезависимо, до 8 результатов (обрезка — у вызывающего). */
function scoreEntries(query) {
	var q = query.toLowerCase();
	var scored = [];

	ensureMenuIndex().forEach(function(entry) {
		var title = entry.title.toLowerCase();
		var href = (entry.href || '').toLowerCase();
		var rank = 0;

		if (title.indexOf(q) === 0)
			rank = 3;
		else if (title.indexOf(q) !== -1)
			rank = 2;
		else if (href.indexOf(q) !== -1)
			rank = 1;

		if (rank)
			scored.push({ entry: entry, rank: rank });
	});

	scored.sort(function(a, b) {
		return (b.rank - a.rank) || a.entry.title.localeCompare(b.entry.title);
	});

	return scored.slice(0, 8).map(function(s) { return s.entry; });
}

/* --------------------------------------------------------------------------
 * П.4 — палитра Ctrl+K / Cmd+K
 * ------------------------------------------------------------------------ */

var palette = {
	overlay: null,
	input: null,
	list: null,
	items: [],
	active: -1,
	prevFocus: null,

	isOpen: function() {
		return !!(this.overlay && this.overlay.parentNode);
	},

	toggle: function() {
		if (this.isOpen())
			this.focusInput();
		else
			this.open();
	},

	build: function() {
		if (this.overlay)
			return;

		var self = this;

		this.input = E('input', {
			'type': 'text',
			'class': 'dv-palette-input',
			'placeholder': _('Поиск по меню…'),
			'autocomplete': 'off',
			'spellcheck': 'false'
		});

		this.list = E('ul', { 'class': 'dv-palette-list' });

		this.overlay = E('div', { 'class': 'dv-palette-overlay' }, [
			E('div', { 'class': 'dv-palette', 'role': 'dialog', 'aria-modal': 'true' }, [
				E('div', { 'class': 'dv-palette-bar' }, [
					(function() {
						var icon = E('span', { 'class': 'dv-palette-icon', 'aria-hidden': 'true' });
						icon.innerHTML = ICON_SEARCH;
						return icon;
					})(),
					this.input
				]),
				this.list
			])
		]);

		/* Клик по подложке (мимо окна) — закрыть */
		this.overlay.addEventListener('mousedown', function(ev) {
			if (ev.target === self.overlay)
				self.close();
		});

		this.input.addEventListener('input', function() {
			self.renderResults();
		});

		this.input.addEventListener('keydown', function(ev) {
			if (ev.key === 'ArrowDown') {
				ev.preventDefault();
				self.move(1);
			} else if (ev.key === 'ArrowUp') {
				ev.preventDefault();
				self.move(-1);
			} else if (ev.key === 'Enter') {
				ev.preventDefault();
				self.go(self.active >= 0 ? self.active : 0);
			} else if (ev.key === 'Escape') {
				ev.preventDefault();
				self.close();
			}
		});
	},

	open: function() {
		this.build();

		if (!this.isOpen()) {
			this.prevFocus = document.activeElement;
			document.body.appendChild(this.overlay);
			document.body.classList.add('dv-palette-open');
		}

		this.input.value = '';
		this.renderResults();
		this.input.focus();
	},

	close: function() {
		if (!this.isOpen())
			return;

		document.body.removeChild(this.overlay);
		document.body.classList.remove('dv-palette-open');

		/* Восстановление фокуса по ТЗ, п.4: возвращаем туда, откуда открыли */
		if (this.prevFocus && document.contains(this.prevFocus))
			this.prevFocus.focus();

		this.prevFocus = null;
		this.items = [];
		this.active = -1;
	},

	focusInput: function() {
		this.input.focus();
		this.input.select();
	},

	move: function(delta) {
		if (!this.items.length)
			return;

		this.active = (this.active + delta + this.items.length) % this.items.length;

		this.list.querySelectorAll('.dv-palette-item').forEach(function(li, i) {
			li.classList.toggle('active', i === this.active);
		}, this);

		var current = this.list.querySelector('.dv-palette-item.active');
		if (current && current.scrollIntoView)
			current.scrollIntoView({ block: 'nearest' });
	},

	go: function(index) {
		var item = this.items[index];
		if (!item)
			return;

		this.close();
		window.location.href = item.href;
	},

	renderResults: function() {
		var self = this;
		var query = this.input.value.trim();

		this.list.innerHTML = '';
		this.items = [];
		this.active = -1;

		if (!query) {
			this.list.appendChild(E('li', { 'class': 'dv-palette-empty' },
				[_('Начните вводить название страницы…')]));
			return;
		}

		var results = scoreEntries(query);

		if (!results.length) {
			this.list.appendChild(E('li', { 'class': 'dv-palette-empty' },
				[_('Ничего не найдено')]));
			return;
		}

		/* Группировка с подписью раздела: подпись ставим перед первым
		 * результатом очередного раздела */
		var lastSection = null;

		results.forEach(function(entry) {
			if (entry.section && entry.section !== lastSection) {
				lastSection = entry.section;
				self.list.appendChild(E('li', { 'class': 'dv-palette-caption' }, [entry.section]));
			}

			var li = E('li', {
				'class': 'dv-palette-item',
				'click': function() { self.go(self.items.indexOf(entry)); }
			}, [entry.title]);

			self.items.push(entry);
			self.list.appendChild(li);
		});

		this.active = 0;
		this.list.querySelector('.dv-palette-item').classList.add('active');
	}
};

/* --------------------------------------------------------------------------
 * П.8 — избранное: звёздочка в заголовке страницы + секция в сайдбаре
 * ------------------------------------------------------------------------ */

function findPageHeading() {
	var h2 = document.querySelector('#view h2');

	/* Запасной вариант для страниц, чей заголовок оказался не в #view
	 * (разметка отдельных приложений может отличаться) */
	if (!h2)
		h2 = document.querySelector('#maincontent .container > h2');

	if (!h2 || !h2.textContent.trim())
		return null;

	/* Заголовки системных предупреждений не считаются заголовком страницы */
	if (h2.closest('.alert-message'))
		return null;

	return h2;
}

function isFavorite(path) {
	return readFavorites().some(function(f) { return f.path === path; });
}

function syncFavStar(btn, path) {
	var fav = isFavorite(path);
	btn.classList.toggle('active', fav);
	btn.innerHTML = fav ? ICON_STAR_FILL : ICON_STAR;
	btn.title = fav ? _('Убрать из избранного') : _('В избранное');
}

function toggleFavorite() {
	var path = currentPath();
	if (!path)
		return;

	var list = readFavorites();
	var existing = list.filter(function(f) { return f.path === path; })[0];

	if (existing) {
		list = list.filter(function(f) { return f.path !== path; });
	} else {
		var h2 = findPageHeading();
		var title = (h2 ? h2.textContent.trim() : '') || path;
		list.unshift({ path: path, title: title });
		list = list.slice(0, DV_FAV_MAX); /* максимум DV_FAV_MAX, свежие сверху */
	}

	writeFavorites(list);
	renderFavStar();
	renderFavorites(document.querySelector('#mainmenu .dv-favorites-slot'));
}

var favStarBtn = null;

function renderFavStar() {
	if (favStarBtn)
		syncFavStar(favStarBtn, currentPath());
}

function initFavStar() {
	var h2 = findPageHeading();
	if (!h2)
		return;

	favStarBtn = E('button', {
		'type': 'button',
		'class': 'dv-fav-star',
		'click': toggleFavorite
	}, [' ']);

	h2.classList.add('dv-fav-target');
	h2.parentNode.insertBefore(favStarBtn, h2.nextSibling);
	syncFavStar(favStarBtn, currentPath());
}

/* Секция «Избранное» в сайдбаре. Вызывается из хука menu-darkvibe.js
 * (контейнер .dv-favorites-slot над меню) и из this-подстраховки модуля.
 * Пустой список = пустой и скрытый контейнер (ТЗ: видна только когда непуста). */
function renderFavorites(container) {
	if (!container)
		return;

	var favs = readFavorites();

	if (!favs.length) {
		container.innerHTML = '';
		container.style.display = 'none';
		return;
	}

	container.style.display = '';
	container.innerHTML = '';

	var icon = E('span', { 'class': 'menu-icon', 'aria-hidden': 'true' });
	icon.innerHTML = ICON_STAR;

	var wrap = E('div', { 'class': 'dv-favorites' }, [
		E('div', { 'class': 'dv-favorites-head' }, [icon, E('span', {}, [_('Избранное')])]),
		E('ul', { 'class': 'dv-fav-list' }, favs.map(function(f) {
			return E('li', {}, [
				E('a', {
					'href': L.url.apply(null, f.path.split('/')),
					'title': f.title
				}, [f.title])
			]);
		}))
	]);

	container.appendChild(wrap);
}

/* --------------------------------------------------------------------------
 * П.9 — статус Морока второй строкой в пункте меню «Морок»
 *
 * Структура ответа ubus morok → status (подтверждена чтением rpcd на
 * устройстве, /usr/libexec/rpcd/morok):
 *   running, engine, enabled, mode, transparent, antidpi,
 *   active_node, active_label, active_broken, active_ping,
 *   chain, kill_switch, all_dead, antidpi_engine, antidpi_running,
 *   awg_available, awg_backend, wizard_done
 * Отдельно берём morok → nodes для счётчика нод (в status его нет).
 * ------------------------------------------------------------------------ */

var morok = {
	disabled: false,   /* пробный вызов не удался — до следующей загрузки страницы молча */
	initialized: false,
	node: null,        /* DOM-узел второй строки */
	timer: null
};

/* Плюрализация «нода/ноды/нод» */
function morokNodesWord(n) {
	var mod100 = n % 100;
	if (mod100 >= 11 && mod100 <= 14)
		return 'нод';
	var mod10 = n % 10;
	if (mod10 === 1)
		return 'нода';
	if (mod10 >= 2 && mod10 <= 4)
		return 'ноды';
	return 'нод';
}

function morokRenderLine(text) {
	if (morok.node)
		morok.node.textContent = text;
}

/* Состояние по полям status: 🔴 не запущен / 🟡 фоллбэк / 🟢 активен */
function morokStateLine(st, nodeCount) {
	if (!st || st.running !== true)
		return '🔴 ' + _('не запущен');

	if (st.all_dead === true || st.active_broken === true)
		return '🟡 ' + _('фоллбэк: резервная нода');

	var label = (nodeCount != null)
		? '%d %s'.format(nodeCount, morokNodesWord(nodeCount))
		: (st.active_label || '');

	return label
		? '🟢 ' + _('%s · прокси активен').format(label)
		: '🟢 ' + _('прокси активен');
}

function morokPoll() {
	if (morok.disabled || !morok.node)
		return;

	/* status — обязательный вызов; nodes — только за счётчиком,
	 * его сбой не должен ронять строку статуса */
	Promise.all([
		withTimeout(callMorokStatus(), MOROK_PROBE_TIMEOUT),
		withTimeout(callMorokNodes(), MOROK_PROBE_TIMEOUT).catch(function() { return null; })
	]).then(function(res) {
		var st = res[0];
		var nodes = (res[1] && Array.isArray(res[1].nodes)) ? res[1].nodes.length : null;
		morokRenderLine(morokStateLine(st, nodes));
	}, function() {
		/* Морок стоит, но не отвечает — опрос продолжаем (ТЗ, п.9) */
		morokRenderLine('🔴 ' + _('не отвечает'));
	});
}

/* Поиск пункта «Морок» в отрендеренном меню: точное совпадение href
 * (без query), чтобы не зацепить детей вида /admin/services/morok/nodes */
function findMorokLink() {
	var found = null;

	document.querySelectorAll('#mainmenu a').forEach(function(a) {
		if (found)
			return;

		var href = (a.getAttribute('href') || '').split('?')[0].replace(/\/+$/, '');

		if (href.slice(-MOROK_MENU_PATH.length) === MOROK_MENU_PATH)
			found = a;
	});

	return found;
}

/* Точка входа хука из menu-darkvibe.js (после построения меню). */
function initMorokStatus() {
	if (morok.disabled || morok.initialized)
		return;

	var link = findMorokLink();
	if (!link)
		return; /* морока нет в меню — обычный пункт, ничего не делаем */

	morok.initialized = true;

	/* Пробный вызов до старта опроса. Любая ошибка (нет ubus-объекта,
	 * ACL запрещает, сеть недоступна) — фича выключается молча до следующей
	 * загрузки страницы: без ошибок в консоли и без изменений меню. */
	withTimeout(callMorokStatus(), MOROK_PROBE_TIMEOUT).then(function() {
		var li = link.parentElement;
		if (!li)
			return;

		morok.node = E('div', { 'class': 'dv-morok-status' });
		li.insertBefore(morok.node, link.nextSibling);

		morokPoll();
		morok.timer = setInterval(morokPoll, MOROK_POLL_MS);
	}, function() {
		morok.disabled = true;
		morok.node = null;
	});
}

/* --------------------------------------------------------------------------
 * Подстраховка интеграции: если menu-darkvibe.js ещё не отрендерил меню
 * к моменту нашей инициализации (или тема без хуков) — следим за #mainmenu
 * и догоняем: перестраиваем индекс, создаём слот избранного, стартуем морока.
 * ------------------------------------------------------------------------ */

function healSidebarHooks() {
	var mainmenu = document.querySelector('#mainmenu');
	if (!mainmenu)
		return;

	/* Слот «Избранное» над меню, если хук menu-darkvibe.js его не создал */
	if (!mainmenu.querySelector(':scope > .dv-favorites-slot') &&
	    mainmenu.querySelector(':scope > ul.nav')) {
		var slot = E('div', { 'class': 'dv-favorites-slot' });
		mainmenu.insertBefore(slot, mainmenu.firstChild);
		renderFavorites(slot);
	}

	if (!morok.initialized && !morok.disabled)
		initMorokStatus();
}

function watchMainMenu() {
	var mainmenu = document.querySelector('#mainmenu');
	if (!mainmenu)
		return;

	var debounce = null;

	var observer = new MutationObserver(function() {
		menuIndexDirty = true;

		if (debounce)
			clearTimeout(debounce);

		/* отложенная перестройка, чтобы не дергаться на пачках мутаций */
		debounce = setTimeout(healSidebarHooks, 100);
	});

	observer.observe(mainmenu, { childList: true, subtree: false });

	/* Если меню уже отрендерено к моменту старта модуля */
	if (mainmenu.querySelector('ul.nav'))
		healSidebarHooks();
}

/* Иконка поиска в шапке — мобильный вход в палитру (ТЗ, п.4: < 768px) */
function initSearchButton() {
	var actions = document.querySelector('.main-right header .header-actions');
	if (!actions)
		return;

	var btn = E('button', {
		'type': 'button',
		'class': 'dv-search-btn',
		'title': _('Поиск по меню (Ctrl+K)'),
		'aria-label': _('Поиск по меню'),
		'click': function() { palette.open(); }
	});

	btn.innerHTML = ICON_SEARCH;
	actions.insertBefore(btn, actions.firstChild);
}

/* --------------------------------------------------------------------------
 * Публичный API для защищённых хуков menu-darkvibe.js
 * ------------------------------------------------------------------------ */

window.DVMenu = {
	setMenuTree: setMenuTree,
	renderFavorites: renderFavorites,
	initMorokStatus: initMorokStatus
};

/* --------------------------------------------------------------------------
 * Модуль
 * ------------------------------------------------------------------------ */

return baseclass.extend({
	__init__: function() {
		/* Вне авторизованных страниц (логин и т.п.) модуль не работает */
		if (!document.body.classList.contains('logged-in'))
			return;

		initSearchButton();
		initFavStar();

		/* View рендерится асинхронно после загрузки модуля — догоняем
		 * звёздочку ограниченным числом попыток */
		var starTries = 0;
		var starTimer = setInterval(function() {
			if (favStarBtn || ++starTries > 24) {
				clearInterval(starTimer);
				return;
			}
			initFavStar();
		}, 500);

		watchMainMenu();

		document.addEventListener('keydown', function(ev) {
			if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && !ev.altKey &&
			    (ev.key === 'k' || ev.key === 'K')) {
				ev.preventDefault();
				palette.toggle();
			}
		});
	}
});
