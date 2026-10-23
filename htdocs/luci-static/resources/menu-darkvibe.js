'use strict';
'require baseclass';
'require ui';

/**
 * DarkVibe — меню темы.
 * Рендерит сайдбар, табы и «хлебные крошки» LuCI, управляет
 * сворачиванием сайдбара (desktop) и off-canvas меню (mobile).
 * Логика по мотивам luci-theme-argon (Apache-2.0), переписана под DarkVibe.
 */

/* --------------------------------------------------------------------------
 * Inline-иконки (стиль lucide, stroke = currentColor)
 * ------------------------------------------------------------------------ */

const ICONS = {
	status: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
	system: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
	services: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>',
	network: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
	statistics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="12" width="3" height="6" rx="1"/><rect x="12" y="8" width="3" height="10" rx="1"/><rect x="17" y="5" width="3" height="13" rx="1"/></svg>',
	nas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>',
	docker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 13.5c0 2.5-2 4-4.5 4H6c-2.8 0-5-2.2-5-5 0-2.1 1.3-3.9 3.2-4.6.3-2.3 2.3-4 4.6-4 1.6 0 3 .8 3.9 2h2.3c2.2 0 4 1.4 4.5 3.4 1.8.4 3.5 2 3.5 4.2z"/><path d="M6 9h2M9 9h2M12 9h2M6 12h2M9 12h2M12 12h2M15 12h2"/></svg>',
	vpn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>',
	freenet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7z"/></svg>',
	firewall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c4.4 0 7-2.8 7-7 0-3-1.5-4.7-2.7-6.2-.4 1.2-1 2-2.3 2.3C13.6 8 13 4.5 9.5 2c.3 3-1 4.5-2.3 6C5.8 9.5 5 11 5 13.5 5 19.2 7.6 22 12 22z"/></svg>',
	default: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/></svg>'
};

/* E() не парсит строку как HTML, поэтому иконку вставляем через innerHTML обёртки */
function iconNode(name) {
	const span = E('span', { 'class': 'menu-icon', 'aria-hidden': 'true' });
	span.innerHTML = ICONS[name] || ICONS.default;
	return span;
}

/* --------------------------------------------------------------------------
 * Мини-анимации раскрытия (высота, без jQuery)
 * ------------------------------------------------------------------------ */

const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function slideDown(el) {
	if (!el) return;
	if (reducedMotion) { el.style.display = ''; return; }
	el.style.display = '';
	const target = el.scrollHeight;
	el.style.overflow = 'hidden';
	el.style.height = '0px';
	el.style.transition = 'height .18s ease-out';
	el.offsetHeight; /* reflow */
	el.style.height = target + 'px';
	setTimeout(function() {
		el.style.height = '';
		el.style.overflow = '';
		el.style.transition = '';
	}, 190);
}

function slideUp(el) {
	if (!el) return;
	if (reducedMotion) { el.style.display = 'none'; return; }
	el.style.overflow = 'hidden';
	el.style.height = el.scrollHeight + 'px';
	el.style.transition = 'height .18s ease-in';
	el.offsetHeight; /* reflow */
	el.style.height = '0px';
	setTimeout(function() {
		el.style.display = 'none';
		el.style.height = '';
		el.style.overflow = '';
		el.style.transition = '';
	}, 190);
}

/* --------------------------------------------------------------------------
 * Модуль меню
 * ------------------------------------------------------------------------ */

return baseclass.extend({
	__init__: function() {
		this.restoreSidebarState();
		ui.menu.load().then(L.bind(this.render, this));
	},

	/* Состояние свёрнутого сайдбара запоминаем на устройстве */
	restoreSidebarState: function() {
		try {
			if (localStorage.getItem('darkvibe.sidebar') === 'collapsed')
				document.body.classList.add('sidebar-collapsed');
		} catch (e) { /* localStorage может быть недоступен */ }
	},

	render: function(tree) {
		var node = tree;
		var url = '';

		/* Хук UX-модуля dv-menu: отдаём дерево меню для полного индекса
		 * палитры Ctrl+K. Защищённый опциональный вызов */
		if (window.DVMenu && typeof window.DVMenu.setMenuTree === 'function')
			window.DVMenu.setMenuTree(tree);

		this.renderModeMenu(tree);

		/* Табы страницы (третий уровень и глубже) */
		if (L.env.dispatchpath.length >= 3) {
			for (var i = 0; i < 3 && node; i++) {
				node = node.children[L.env.dispatchpath[i]];
				url = url + (url ? '/' : '') + L.env.dispatchpath[i];
			}

			if (node)
				this.renderTabMenu(node, url);
		}

		this.bindChrome();

		/* Прокручиваем активный пункт меню в видимую область */
		var active = document.querySelector('#mainmenu a.active');
		if (active && active.scrollIntoView)
			active.scrollIntoView({ block: 'nearest' });

		/* Хук UX-модуля dv-menu: статус Морока второй строкой в пункте меню.
		 * Защищённый опциональный вызов — тема работает без dv-menu.js и
		 * без установленного приложения Морок */
		if (window.DVMenu && typeof window.DVMenu.initMorokStatus === 'function')
			window.DVMenu.initMorokStatus();
	},

	/* Кнопки: сворачивание (desktop), бургер и маска (mobile) */
	bindChrome: function() {
		var toggler = document.querySelector('.sidenav-toggler');
		var showSide = document.querySelector('.showSide');
		var darkMask = document.querySelector('.darkMask');

		if (toggler)
			toggler.addEventListener('click', L.bind(this.handleSidebarCollapse, this));

		if (showSide)
			showSide.addEventListener('click', L.bind(this.handleSidebarToggle, this));

		if (darkMask)
			darkMask.addEventListener('click', L.bind(this.handleSidebarToggle, this));

		document.addEventListener('keydown', L.bind(function(ev) {
			if (ev.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
				this.handleSidebarToggle();
				if (showSide) showSide.focus();
			}
		}, this));
	},

	handleSidebarCollapse: function() {
		var collapsed = document.body.classList.toggle('sidebar-collapsed');
		try {
			localStorage.setItem('darkvibe.sidebar', collapsed ? 'collapsed' : 'expanded');
		} catch (e) { }
	},

	handleSidebarToggle: function() {
		var open = document.body.classList.toggle('sidebar-open');
		var showSide = document.querySelector('.showSide');
		var darkMask = document.querySelector('.darkMask');

		if (showSide)
			showSide.setAttribute('aria-expanded', open ? 'true' : 'false');

		if (darkMask)
			darkMask.classList.toggle('active', open);
	},

	/* Раскрытие/сворачивание подменю первого уровня */
	handleMenuExpand: function(ev) {
		var target = ev.currentTarget;
		var slideMenu = target.nextElementSibling;
		var shouldCollapse = false;

		document.querySelectorAll('#mainmenu .nav > li > ul.active').forEach(function(ul) {
			if (ul === slideMenu)
				shouldCollapse = true;

			ul.classList.remove('active');
			if (ul.previousElementSibling)
				ul.previousElementSibling.classList.remove('active');
			slideUp(ul);
		});

		if (!slideMenu || shouldCollapse) {
			ev.preventDefault();
			ev.stopPropagation();
			return;
		}

		slideMenu.classList.add('active');
		target.classList.add('active');
		slideDown(slideMenu);

		ev.preventDefault();
		ev.stopPropagation();
	},

	renderMainMenu: function(tree, url, level) {
		var currentLevel = (level || 0) + 1;
		var menuContainer = E('ul', { 'class': level ? 'slide-menu' : 'nav' });
		var children = ui.menu.getChildren(tree);

		if (children.length === 0 || currentLevel > 2)
			return E([]);

		for (var i = 0; i < children.length; i++) {
			var child = children[i];
			var isActive = (
				(L.env.dispatchpath[currentLevel] === child.name) &&
				(L.env.dispatchpath[currentLevel - 1] === tree.name)
			);

			var submenu = this.renderMainMenu(child, url + '/' + child.name, currentLevel);
			var hasChildren = submenu.children.length > 0;

			var slideClass = hasChildren ? 'slide' : null;
			var menuClass = hasChildren ? 'menu' : 'food';

			if (isActive) {
				menuContainer.classList.add('active');
				slideClass += ' active';
				menuClass += ' active';
			}

			var label = currentLevel === 1
				? [ iconNode(child.name), E('span', { 'class': 'menu-text' }, [ _(child.title) ]) ]
				: [ _(child.title) ];

			var menuItem = E('li', { 'class': slideClass }, [
				E('a', {
					'href': L.url(url, child.name),
					'title': currentLevel === 1 ? _(child.title) : null,
					'click': (currentLevel === 1 && hasChildren) ? ui.createHandlerFn(this, 'handleMenuExpand') : null,
					'class': menuClass
				}, label),
				submenu
			]);

			menuContainer.appendChild(menuItem);
		}

		/* Раскрываем активную ветку сразу, без анимации */
		if (currentLevel === 1) {
			var mainMenuElement = document.querySelector('#mainmenu');

			if (mainMenuElement) {
				/* Хук UX-модуля dv-menu: слот «Избранное» над меню.
				 * Защищённый опциональный вызов — тема работает без dv-menu.js */
				if (window.DVMenu && typeof window.DVMenu.renderFavorites === 'function') {
					var favSlot = mainMenuElement.querySelector(':scope > .dv-favorites-slot');

					if (!favSlot) {
						favSlot = E('div', { 'class': 'dv-favorites-slot' });
						/* menuContainer на этом этапе ещё не вложен в #mainmenu —
						 * вставляем слот либо перед ним, либо первым в #mainmenu */
						if (menuContainer.parentNode === mainMenuElement)
							mainMenuElement.insertBefore(favSlot, menuContainer);
						else
							mainMenuElement.insertBefore(favSlot, mainMenuElement.firstChild);
					}

					window.DVMenu.renderFavorites(favSlot);
				}

				mainMenuElement.appendChild(menuContainer);
				mainMenuElement.querySelectorAll('ul.slide-menu.active').forEach(function(ul) {
					ul.style.display = '';
				});
				mainMenuElement.style.display = '';
			}
		}

		return menuContainer;
	},

	/* Верхний ряд «Status | System | ...» в подвале (оставляем как в argon/bootstrap) */
	renderModeMenu: function(tree) {
		var menu = document.querySelector('#modemenu');
		var children = ui.menu.getChildren(tree);

		for (var i = 0; i < children.length; i++) {
			var isActive = (L.env.requestpath.length ? children[i].name == L.env.requestpath[0] : i == 0);

			if (i > 0)
				menu.appendChild(E([], [ ' | ' ]));

			menu.appendChild(E('li', {}, [
				E('a', {
					'href': L.url(children[i].name),
					'class': isActive ? 'active' : null
				}, [ _(children[i].title) ])
			]));

			if (isActive)
				this.renderMainMenu(children[i], children[i].name);
		}

		if (menu.children.length > 1)
			menu.style.display = '';
	},

	renderTabMenu: function(tree, url, level) {
		var container = document.querySelector('#tabmenu');
		var currentLevel = (level || 0) + 1;
		var tabContainer = E('ul', { 'class': 'tabs' });
		var children = ui.menu.getChildren(tree);
		var activeNode = null;

		if (children.length === 0)
			return E([]);

		for (var i = 0; i < children.length; i++) {
			var child = children[i];
			var isActive = (L.env.dispatchpath[currentLevel + 2] === child.name);

			tabContainer.appendChild(E('li', { 'class': 'tabmenu-item-%s%s'.format(child.name, isActive ? ' active' : '') }, [
				E('a', { 'href': L.url(url, child.name) }, [ _(child.title) ])
			]));

			if (isActive)
				activeNode = child;
		}

		if (container) {
			container.appendChild(tabContainer);
			container.style.display = '';

			if (activeNode)
				this.renderTabMenu(activeNode, url + '/' + activeNode.name, currentLevel);
		}

		return tabContainer;
	}
});
