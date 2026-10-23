'use strict';
'require ui';
'require baseclass';

/**
 * DarkVibe UX-модуль dv-copy — копирование «технических» значений в один клик.
 * ТЗ: TZ-UX-volna1.md §6.
 *
 * Автодетект IPv4 / IPv6 / MAC / UUID / hex (>= 16 символов) внутри типовых
 * контейнеров LuCI (.td, .cbi-value-field, .ifacebadge, #syslog) и таблиц
 * приложения «Морок» (классы .fn-*, страницы с body.morok-page).
 *
 * Поведение:
 *  - ховер над значением → плавающая иконка копирования справа от значения;
 *  - клик по иконке или двойной клик по значению → буфер обмена + тост «Скопировано»;
 *  - внутри input/textarea и кликабельных элементов (a, button, .cbi-dropdown,
 *    label.fn-tgl) не применяется.
 *
 * Все обработчики делегированные (document) — работают с контентом,
 * подгруженным после загрузки страницы, без повторного сканирования DOM.
 */

/* --------------------------------------------------------------------------
 * Детектор «технических» значений
 * ------------------------------------------------------------------------ */

const RE_IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?\b/;
const RE_MAC  = /\b[0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5}\b/;
/* Сжатые формы (::) покрываются за счёт {0,4} на каждую группу.
 * IPv6 проверяем вхождением hex-символа, чтобы отсечь вырожденные совпадения вида "::". */
const RE_IPV6 = /(?<![0-9a-fA-F:])(?:[0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(?:\/\d{1,3})?(?![0-9a-fA-F:])/;
const RE_UUID = /\b[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\b/;
const RE_HEX  = /\b[0-9a-fA-F]{16,}\b/;

const PATTERNS = [RE_IPV4, RE_MAC, RE_IPV6, RE_UUID, RE_HEX];

/*
 * Контейнеры со значениями. Общий селектор [class*="fn-"] покрывает классы
 * Морока (.fn-rowname, .fn-badge, ячейки таблиц .fn-main/.fn-table — td
 * находится через ближайшего предка с классом .fn-*, не дублируя обработчики).
 */
const CONTAINER_SEL = '.td, .cbi-value-field, .ifacebadge, .ifacebox-body, #syslog, [class*="fn-"]';

/* Не применяем внутри кликабельных элементов и полей ввода */
const SKIP_SEL = 'a, button, .cbi-dropdown, label.fn-tgl, input, textarea, select';

/* Не ищем дальше первых 1500 символов текста контейнера */
const TEXT_LIMIT = 1500;

function findValue(text) {
	if (!text)
		return null;

	text = String(text).slice(0, TEXT_LIMIT);

	for (let i = 0; i < PATTERNS.length; i++) {
		const m = PATTERNS[i].exec(text);

		if (!m)
			continue;

		/* отсекаем вырожденные IPv6-совпадения без единого hex-символа */
		if (PATTERNS[i] === RE_IPV6 && !/[0-9a-fA-F]/.test(m[0]))
			continue;

		return m[0];
	}

	return null;
}

function candidateFrom(target) {
	if (!(target instanceof Element))
		return null;

	/* кликабельное / поле ввода — не трогаем */
	if (target.closest(SKIP_SEL))
		return null;

	const el = target.closest(CONTAINER_SEL);

	if (!el)
		return null;

	const value = findValue(el.textContent);

	if (!value)
		return null;

	return { el: el, value: value };
}

/* --------------------------------------------------------------------------
 * Буфер обмена: navigator.clipboard с фолбэком на execCommand
 * (LuCI часто открыт по http — secure context не гарантирован)
 * ------------------------------------------------------------------------ */

function legacyCopy(text) {
	const ta = E('textarea', {
		'style': 'position:fixed; top:-9999px; left:-9999px; opacity:0;'
	});

	ta.value = text;
	document.body.appendChild(ta);
	ta.focus();
	ta.select();
	ta.setSelectionRange(0, ta.value.length);

	try {
		document.execCommand('copy');
	}
	catch (e) { /* молча: ниже тост всё равно покажем */ }

	document.body.removeChild(ta);
}

function copyText(text) {
	if (navigator.clipboard && window.isSecureContext) {
		return navigator.clipboard.writeText(text).catch(function() {
			legacyCopy(text);
		});
	}

	try {
		legacyCopy(text);
	}
	catch (e) { }

	return Promise.resolve();
}

/* --------------------------------------------------------------------------
 * Тост «Скопировано»
 * ------------------------------------------------------------------------ */

function ownToast() {
	const t = E('div', { 'class': 'dv-copy-toast-own' }, _('Copied'));

	document.body.appendChild(t);

	setTimeout(function() {
		if (t.parentNode)
			t.parentNode.removeChild(t);
	}, 1600);
}

function showToast() {
	if (typeof ui !== 'undefined' && ui &&
	    typeof ui.addTimeLimitedNotification === 'function') {
		try {
			ui.addTimeLimitedNotification(null, _('Copied'), 1600,
				'success', 'dv-copy-toast');
			return;
		}
		catch (e) { /* фолбэк ниже */ }
	}

	ownToast();
}

/* --------------------------------------------------------------------------
 * Иконка копирования (inline SVG, lucide-стиль, stroke = currentColor)
 * ------------------------------------------------------------------------ */

const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

let current = null;
let flashTimer = null;

const btn = E('span', {
	'class': 'dv-copy-btn',
	'role': 'button',
	'tabindex': '-1',
	'title': _('Copy')
});

/* E() не парсит строку как HTML, поэтому SVG вставляем через innerHTML,
 * как в menu-darkvibe.js */
btn.innerHTML = '<span class="dv-copy-ic dv-copy-ic-copy">' + ICON_COPY + '</span>' +
	'<span class="dv-copy-ic dv-copy-ic-check">' + ICON_CHECK + '</span>';

function hideIcon() {
	current = null;
	btn.classList.remove('dv-copy-show', 'dv-copy-done');
}

/* Позиция справа от конца строки со значением: через caretRangeFromPoint
 * ищем конец текста в точке правой границы контейнера — иначе (широкое
 * .cbi-value-field) иконка улетела бы в дальний правый край блока. */
function valueEndPoint(rect) {
	const y = Math.round(rect.top + rect.height / 2);
	const x = Math.max(rect.left + 1, Math.round(rect.right) - 1);

	try {
		let node = null, offset = 0;

		if (document.caretRangeFromPoint) {
			const r = document.caretRangeFromPoint(x, y);
			if (r) { node = r.startContainer; offset = r.startOffset; }
		}
		else if (document.caretPositionFromPoint) {
			const p = document.caretPositionFromPoint(x, y);
			if (p) { node = p.offsetNode; offset = p.offset; }
		}

		if (node) {
			const range = document.createRange();
			range.setStart(node, offset);
			range.collapse(true);

			const r2 = range.getBoundingClientRect();

			if (r2 && r2.height > 0 && r2.right >= rect.left && r2.right <= rect.right + 2)
				return { x: r2.right, y: r2.top + r2.height / 2 };
		}
	}
	catch (e) { /* фолбэк на границу контейнера */ }

	return { x: rect.right, y: rect.top + rect.height / 2 };
}

function showIcon(cand) {
	const rect = cand.el.getBoundingClientRect();

	if (rect.width === 0 || rect.height === 0) {
		hideIcon();
		return;
	}

	const p = valueEndPoint(rect);

	btn.style.left = Math.min(window.innerWidth - 28, Math.max(4, Math.round(p.x) + 4)) + 'px';
	btn.style.top = Math.max(4, Math.round(p.y) - 11) + 'px';
	btn.classList.add('dv-copy-show');
}

function flashIcon() {
	btn.classList.add('dv-copy-done');

	if (flashTimer)
		clearTimeout(flashTimer);

	flashTimer = setTimeout(function() {
		btn.classList.remove('dv-copy-done');
	}, 900);
}

function copyValue(text) {
	copyText(text).then(function() {
		flashIcon();
		showToast();
	});
}

/* --------------------------------------------------------------------------
 * Делегированные обработчики
 * ------------------------------------------------------------------------ */

document.addEventListener('mousemove', function(ev) {
	/* движение внутри самой иконки не должно её гасить — иначе клик
	 * промахивается (к моменту click current уже null) */
	if (ev.target instanceof Element && ev.target.closest('.dv-copy-btn'))
		return;

	const cand = candidateFrom(ev.target);

	if (!cand) {
		if (current)
			hideIcon();
		return;
	}

	if (current && current.el === cand.el && current.value === cand.value)
		return;

	current = cand;
	showIcon(cand);
}, { passive: true });

document.addEventListener('dblclick', function(ev) {
	const cand = candidateFrom(ev.target);

	if (!cand)
		return;

	ev.preventDefault();
	copyValue(cand.value);
});

/* иконка плавает поверх страницы — при скролле/ресайзе перепозиционируем */
window.addEventListener('scroll', function() {
	if (current)
		showIcon(current);
}, { capture: true, passive: true });

window.addEventListener('resize', function() {
	if (current)
		showIcon(current);
}, { passive: true });

window.addEventListener('blur', hideIcon);

btn.addEventListener('click', function(ev) {
	ev.preventDefault();
	ev.stopPropagation();

	if (current)
		copyValue(current.value);
});

btn.addEventListener('mousedown', function(ev) {
	ev.stopPropagation();
});

btn.addEventListener('dblclick', function(ev) {
	ev.stopPropagation();
});

document.body.appendChild(btn);

/* --------------------------------------------------------------------------
 * Публичный API модуля.
 * L.require инстанцирует результат как класс — возвращаем расширение
 * baseclass (обработчики уже навешаны при исполнении модуля выше).
 * ------------------------------------------------------------------------ */

return baseclass.extend({
	__init__: function() {},
	copyText: copyText,
	showToast: showToast
});
