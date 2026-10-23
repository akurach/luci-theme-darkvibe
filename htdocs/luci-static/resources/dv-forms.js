'use strict';
'require baseclass';
'require ui';

/**
 * DarkVibe — защита несохранённых изменений форм (ТЗ, п.3 и п.7).
 *
 * П.3 — два уровня защиты:
 *   1. beforeunload: пока форма «грязная», закрытие/обновление вкладки
 *      вызывает стандартный браузерный диалог.
 *   2. Черновик в localStorage: грязная форма сериализуется раз в 5 с
 *      по ключу dv-draft:<путь>. При повторном открытии чистой формы
 *      показывается тост «Восстановить / Удалить».
 *
 * П.7 — подтверждение ухода: переходы по ссылкам из сайдбара (.main-left),
 * вкладок (#tabmenu) и контента (#maincontent) при грязной форме
 * перехватываются, показывается модалка «Остаться / Уйти».
 *
 * «Грязность» снимается после штатного apply/save/revert (клики по кнопкам
 * плюс события uci-applied / uci-reverted из ui.js) — штатный apply LuCI
 * не переписывается. На страницах без .cbi-map модуль молчит.
 */

const DRAFT_PREFIX = 'dv-draft:';
const DRAFT_INTERVAL = 5000;

/* Типы полей, которые не сериализуем (кнопки, файлы — определённо теряются) */
const SKIP_TYPES = { 'submit': 1, 'button': 1, 'image': 1, 'reset': 1, 'file': 1 };

/* Ключ черновика: по dispatch-пути LuCI, фолбэк — pathname */
function draftKey() {
	var path = (L.env.requestpath && L.env.requestpath.length)
		? L.env.requestpath.join('/')
		: location.pathname;

	return DRAFT_PREFIX + path;
}

/* Видимые сериализуемые поля формы (есть имя/id, не скрыты через display:none) */
function collectFields(root) {
	var nodes = root.querySelectorAll('input, select, textarea');
	var out = [];

	for (var i = 0; i < nodes.length; i++) {
		var el = nodes[i];
		var type = (el.type || '').toLowerCase();

		if (SKIP_TYPES[type])
			continue;

		if (!el.name && !el.id)
			continue;

		if (el.offsetParent === null)
			continue;

		out.push(el);
	}

	return out;
}

/* Сериализация: { имя: {t: тип, v: значение, c: checked} } */
function serializeForm(root) {
	var data = {};

	collectFields(root).forEach(function(el) {
		var name = el.name || el.id;
		var type = (el.type || '').toLowerCase();

		if (type === 'checkbox' || type === 'radio')
			data[name] = { 't': type, 'v': el.value, 'c': !!el.checked };
		else
			data[name] = { 't': type, 'v': el.value };
	});

	return data;
}

/* Восстановление значений по именам; «грязные» кейсы пропускаем молча */
function restoreForm(root, data) {
	collectFields(root).forEach(function(el) {
		var name = el.name || el.id;
		var rec = data[name];
		var type = (el.type || '').toLowerCase();

		if (!rec)
			return;

		try {
			if (rec.t === 'checkbox') {
				if (type === 'checkbox')
					el.checked = !!rec.c;
			}
			else if (rec.t === 'radio') {
				if (type === 'radio' && el.value === rec.v)
					el.checked = true;
			}
			else {
				el.value = rec.v;
			}

			/* оповещаем виджеты LuCI (cbi-dropdown и пр.) о новом значении */
			el.dispatchEvent(new Event('change', { 'bubbles': true }));
		}
		catch (e) { /* поле могло исчезнуть/смениться — пропускаем */ }
	});
}

return baseclass.extend({
	__init__: function() {
		this.dirty = false;
		this.map = null;

		/* Формы в LuCI 25 рендерятся асинхронно (JS-view), и момент
		 * рендера гоняется с загрузкой модуля: luci-loaded может уйти
		 * раньше, чем мы успеем подписаться. Поэтому честный поллинг:
		 * boot() идемпотентен, дёргаем до 24 раз раз в 500 мс. */
		if (!this.boot()) {
			var tries = 0;
			var timer = setInterval(L.bind(function() {
				if (this.boot() || ++tries >= 24)
					clearInterval(timer);
			}, this), 500);
		}
	},

	/* Инициализация, когда форма появилась; повторные вызовы — no-op.
	 * Возвращает true, если модуль стартовал. */
	boot: function() {
		if (this.map)
			return true;

		this.map = document.querySelector('#maincontent .cbi-map');

		/* На страницах без форм модуль молчит */
		if (!this.map)
			return false;

		this.bindDirtyTracking();
		this.bindApplyReset();
		this.bindNavigationGuard();
		this.bindBeforeUnload();
		this.startDraftTimer();
		this.offerDraftRestore();

		return true;
	},

	/* Любой ввод в полях формы помечает её «грязной» */
	bindDirtyTracking: function() {
		var content = document.getElementById('maincontent');

		if (!content)
			return;

		var markDirty = L.bind(function() {
			this.dirty = true;
		}, this);

		content.addEventListener('input', markDirty, true);
		content.addEventListener('change', markDirty, true);
	},

	/* Снятие грязности: оптимистично по клику (форма перерендеривается)
	 * и гарантированно по подтверждённым событиям из ui.js */
	bindApplyReset: function() {
		document.addEventListener('click', L.bind(function(ev) {
			var btn = (ev.target.closest)
				? ev.target.closest('.cbi-button-apply, .cbi-button-reset, .cbi-button-save')
				: null;

			if (btn)
				this.clearDirty();
		}, this), true);

		document.addEventListener('uci-applied', L.bind(function() {
			this.clearDirty();
		}, this));

		document.addEventListener('uci-reverted', L.bind(function() {
			this.clearDirty();
		}, this));
	},

	clearDirty: function() {
		this.dirty = false;
		this.removeDraft();
	},

	removeDraft: function() {
		try {
			localStorage.removeItem(draftKey());
		}
		catch (e) { /* localStorage недоступен — игнорируем */ }
	},

	/* Делегированный перехват переходов (capture-фаза: раньше обработчиков меню) */
	bindNavigationGuard: function() {
		document.addEventListener('click', L.bind(this.handleNavigate, this), true);
	},

	handleNavigate: function(ev) {
		if (!this.dirty)
			return;

		if (ev.button !== 0 || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey)
			return;

		var link = (ev.target.closest)
			? ev.target.closest('a')
			: null;

		if (!link)
			return;

		/* Перехватываем только зоны из ТЗ: сайдбар, табы, контент */
		if (!link.closest('.main-left, #tabmenu, #maincontent'))
			return;

		if (link.target && link.target !== '_self')
			return;

		var href = link.getAttribute('href') || '';

		if (!href || href.charAt(0) === '#')
			return;

		if (/^(javascript:|mailto:|tel:)/i.test(href))
			return;

		/* Ссылка на текущую страницу (якорь) — не уход */
		if (link.href.split('#')[0] === location.href.split('#')[0])
			return;

		ev.preventDefault();
		ev.stopPropagation();

		this.showLeaveModal(link.href);
	},

	/* Модалка подтверждения ухода. Порядок кнопок важен: первая в
	 * .button-row срабатывает по Esc (обработчик cancelModal из ui.js),
	 * поэтому «Остаться» идёт первой. */
	showLeaveModal: function(href) {
		var stay = function() {
			ui.hideModal();
		};

		var leave = L.bind(function() {
			ui.hideModal();
			/* Флаг снимаем, чтобы beforeunload не дублировал вопрос;
			 * черновик намеренно оставляем — пригодится при возврате. */
			this.dirty = false;
			location.href = href;
		}, this);

		ui.showModal(_('Unsaved changes'), [
			E('p', _('There are unsaved changes on this page. Leave without saving?')),
			E('div', { 'class': 'button-row' }, [
				E('button', { 'class': 'btn cbi-button', 'click': stay }, [ _('Stay') ]),
				' ',
				E('button', { 'class': 'btn cbi-button cbi-button-negative', 'click': leave }, [ _('Leave') ])
			])
		]);
	},

	bindBeforeUnload: function() {
		window.addEventListener('beforeunload', L.bind(function(ev) {
			if (!this.dirty)
				return;

			ev.preventDefault();
			ev.returnValue = '';
		}, this));
	},

	/* Черновик пишется раз в 5 с, только пока форма грязная */
	startDraftTimer: function() {
		setInterval(L.bind(function() {
			if (!this.dirty)
				return;

			try {
				localStorage.setItem(draftKey(), JSON.stringify(serializeForm(this.map)));
			}
			catch (e) { /* quota / приватный режим — молча пропускаем тик */ }
		}, this), DRAFT_INTERVAL);
	},

	/* Тост «Найден несохранённый черновик» с кнопками, показываемый один раз
	 * при загрузке страницы, если черновик есть, а форма сейчас чистая */
	offerDraftRestore: function() {
		var data = null;

		try {
			var raw = localStorage.getItem(draftKey());

			if (raw)
				data = JSON.parse(raw);
		}
		catch (e) { /* битый JSON — покажем предложение с пустым набором нельзя */ }

		if (!data || typeof data !== 'object')
			return;

		var self = this;
		var msg = null;

		var close = function() {
			if (msg && msg.parentNode)
				msg.parentNode.removeChild(msg);
		};

		var restore = function(ev) {
			if (ev) ev.preventDefault();
			self.removeDraft();
			close();
			restoreForm(self.map, data);
			self.dirty = true; /* восстановленная форма снова под защитой */
		};

		var dismiss = function(ev) {
			if (ev) ev.preventDefault();
			self.removeDraft();
			close();
		};

		msg = ui.addNotification(
			_('Unsaved draft found'),
			E('div', {}, [
				E('p', _('An unsaved draft from a previous visit was found on this page.')),
				E('div', { 'class': 'dv-draft-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-positive',
						'click': restore
					}, [ _('Restore') ]),
					' ',
					E('button', {
						'class': 'btn cbi-button',
						'click': dismiss
					}, [ _('Delete') ])
				])
			]),
			'warning'
		);
	}
});
