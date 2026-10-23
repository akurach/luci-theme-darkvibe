/*
 * DarkVibe UX-модуль dv-dropdown — поиск внутри длинных dropdown'ов.
 * ТЗ: TZ-UX-volna1.md, п.5.
 *
 * Логика DOM-уровнем, без monkey-patch классов ui.js:
 *  - MutationObserver следит за атрибутом [open] на div.cbi-dropdown
 *    (ui.js открывает меню и мышью, и клавиатурой, но всегда ставит [open]
 *    и класс ul.dropdown синхронно в openDropdown — это самый надёжный сигнал);
 *  - при открытии меню с > 12 пунктами первым элементом ul.dropdown
 *    вставляется поле input.dv-dd-filter (при закрытии удаляется — ul.dropdown
 *    при закрытии превращается в "лицо" виджета, лишний элемент там недопустим);
 *  - клавиатура перехватывается на document в capture-фазе: пока фильтр есть,
 *    печать из меню перенаправляется в него, стрелки/Enter/Esc обрабатываем сами
 *    (штатная навигация ui.js идёт по соседям и ломается на скрытых пунктах).
 * Комбо-кнопки (.cbi-dropdown.btn/.cbi-button) и нативные select не затрагиваются.
 */

'use strict';
'require baseclass';

(function() {

	/* Порог: фильтр только для меню длиннее 12 пунктов (ТЗ п.5) */
	var MIN_ITEMS = 12;

	/* ------------------------------------------------------------------
	 * Утилиты
	 * ---------------------------------------------------------------- */

	/* Видимые пункты меню: без служебного "Нет совпадений" и не скрытые фильтром */
	function visibleItems(input) {
		var ul = input.parentNode;
		var out = [];
		for (var i = 0; i < ul.children.length; i++) {
			var li = ul.children[i];
			if (li.tagName !== 'LI' || li.classList.contains('dv-dd-empty'))
				continue;
			if (li.style.display === 'none')
				continue;
			out.push(li);
		}
		return out;
	}

	/* ------------------------------------------------------------------
	 * Построение/удаление фильтра
	 * ---------------------------------------------------------------- */

	function teardownFilter(sb) {
		var input = sb.querySelector('input.dv-dd-filter');
		if (input && input.parentNode)
			input.parentNode.removeChild(input);

		var empty = sb.querySelector('li.dv-dd-empty');
		if (empty && empty.parentNode)
			empty.parentNode.removeChild(empty);

		/* Возвращаем скрытые фильтром пункты (на случай закрытия без сброса) */
		var lis = sb.querySelectorAll('ul.dropdown > li');
		for (var i = 0; i < lis.length; i++)
			lis[i].style.display = '';
	}

	/* Вставка фильтра в открытое меню; возвращает input или null */
	function setupFilter(sb) {
		var ul = sb.querySelector('ul.dropdown');
		if (!ul)
			return null;

		/* Перестраховка от повторного вызова: свежее состояние (ТЗ: сброс) */
		teardownFilter(sb);

		/* Считаем только реальные пункты меню */
		var count = 0;
		for (var i = 0; i < ul.children.length; i++) {
			if (ul.children[i].tagName === 'LI')
				count++;
		}

		if (count <= MIN_ITEMS)
			return null;

		/* Поле фильтра — первый элемент меню, липкое при скролле (CSS) */
		var input = document.createElement('input');
		input.type = 'text';
		input.className = 'dv-dd-filter';
		input.placeholder = 'Найти…';
		input.setAttribute('aria-label', 'Найти…');
		input.autocomplete = 'off';
		input.spellcheck = false;

		/* Клик по полю не должен доходить до обработчиков ui.js */
		input.addEventListener('click', function(ev) {
			ev.stopPropagation();
		});

		/* Ввод фильтрует список */
		input.addEventListener('input', function() {
			applyFilter(input);
		});

		ul.insertBefore(input, ul.firstChild);

		/* Пункт-заглушка "Нет совпадений": неактивный, невидим по умолчанию.
		 * unselectable — штатный признак ui.js, исключает пункт из выбора;
		 * pointer-events: none — в CSS, клик не должен попадать в ui.js. */
		var empty = document.createElement('li');
		empty.className = 'dv-dd-empty';
		empty.setAttribute('unselectable', '');
		empty.textContent = 'Нет совпадений';
		empty.style.display = 'none';
		ul.appendChild(empty);

		return input;
	}

	/* ------------------------------------------------------------------
	 * Фильтрация
	 * ---------------------------------------------------------------- */

	function applyFilter(input) {
		var ul = input.parentNode;
		var q = input.value.trim().toLowerCase();
		var visible = 0;

		for (var i = 0; i < ul.children.length; i++) {
			var li = ul.children[i];
			if (li.tagName !== 'LI' || li.classList.contains('dv-dd-empty'))
				continue;

			var match = (q === '') || (li.textContent.toLowerCase().indexOf(q) !== -1);
			li.style.display = match ? '' : 'none';
			if (match)
				visible++;
		}

		/* Подсветка активного пункта сбрасывается при изменении списка */
		var active = ul.querySelector('li.dv-dd-active');
		if (active && active.style.display === 'none')
			active.classList.remove('dv-dd-active');

		var empty = ul.querySelector('li.dv-dd-empty');
		if (empty)
			empty.style.display = (visible === 0) ? '' : 'none';
	}

	/* ------------------------------------------------------------------
	 * Клавиатурная навигация по отфильтрованному списку
	 * ---------------------------------------------------------------- */

	/* Перемещение подсветки по видимым пунктам; dir: 1 вниз, -1 вверх */
	function moveActive(input, dir) {
		var items = visibleItems(input);
		if (items.length === 0)
			return;

		var idx = -1;
		for (var i = 0; i < items.length; i++) {
			if (items[i].classList.contains('dv-dd-active')) {
				idx = i;
				break;
			}
		}

		/* С зацикливанием на концах списка */
		var next = items[(idx + dir + items.length) % items.length];

		for (var j = 0; j < items.length; j++)
			items[j].classList.remove('dv-dd-active');

		next.classList.add('dv-dd-active');
		if (next.scrollIntoView)
			next.scrollIntoView({ block: 'nearest' });
	}

	/* Enter: "клик" по подсветленному или первому видимому пункту.
	 * Клик проходит через штатный обработчик ui.js (выбор/закрытие),
	 * для multiple-списков меню остаётся открытым — как при клике мышью. */
	function chooseActive(input) {
		var items = visibleItems(input);
		if (items.length === 0)
			return;

		var active = null;
		for (var i = 0; i < items.length; i++) {
			if (items[i].classList.contains('dv-dd-active')) {
				active = items[i];
				break;
			}
		}

		(active || items[0]).click();
	}

	/* Esc: закрытие через штатное событие ui.js, фокус — обратно на виджет */
	function closeDropdown(sb) {
		sb.dispatchEvent(new CustomEvent('cbi-dropdown-close'));
		if (sb.focus)
			sb.focus();
	}

	/* ------------------------------------------------------------------
	 * Глобальный перехват клавиатуры (capture-фаза).
	 * ui.js вешает keydown на сам виджет и в bubble-фазе; наш capture
	 * обработчик отрабатывает раньше, stopPropagation глушит ui.js.
	 * ---------------------------------------------------------------- */

	document.addEventListener('keydown', function(ev) {
		var sb = document.querySelector('.cbi-dropdown[open]');
		if (!sb)
			return;

		/* Фильтр есть не во всяком открытом dropdown (короткие списки) */
		var input = sb.querySelector('input.dv-dd-filter');
		if (!input)
			return;

		/* 1) Фокус уже в поле фильтра: стрелки/Enter/Esc берём на себя,
		 *    печать идёт штатно (ввод самого текста). */
		if (ev.target === input) {
			switch (ev.key) {
			case 'ArrowDown':
				moveActive(input, 1);
				break;
			case 'ArrowUp':
				moveActive(input, -1);
				break;
			case 'Enter':
				chooseActive(input);
				break;
			case 'Escape':
				closeDropdown(sb);
				break;
			default:
				return;
			}
			ev.preventDefault();
			ev.stopPropagation();
			return;
		}

		/* 2) Чужие поля ввода (например, create-item комбобокса) не трогаем —
		 *    их обрабатывает сам ui.js (он для input-целей выходит рано). */
		if (ev.target && ev.target.closest &&
		    ev.target.closest('input, textarea, select'))
			return;

		/* 3) Фокус вне этого dropdown — не лезем (другие виджеты, хоткеи) */
		if (!sb.contains(ev.target))
			return;

		/* 4) Фокус внутри открытого меню (ul/li/виджет): печать перенаправляем
		 *    в фильтр, навигацию — на свои обработчики. */
		switch (ev.key) {
		case 'ArrowDown':
			input.focus();
			moveActive(input, 1);
			break;
		case 'ArrowUp':
			input.focus();
			moveActive(input, -1);
			break;
		case 'Enter':
			chooseActive(input);
			break;
		case 'Escape':
			closeDropdown(sb);
			break;
		default:
			/* Delete у курсора (курсор всегда в конце) — как Backspace */
			if (ev.key === 'Backspace' || ev.key === 'Delete') {
				input.focus();
				input.value = input.value.slice(0, -1);
				applyFilter(input);
			}
			else if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
				input.focus();
				input.value += ev.key;
				applyFilter(input);
			}
			else {
				return;
			}
			break;
		}
		ev.preventDefault();
		ev.stopPropagation();
	}, true);

	/* ------------------------------------------------------------------
	 * Детект открытия/закрытия: MutationObserver по атрибуту [open].
	 * ui.js открывает меню только через openDropdown(), который атомарно
	 * ставит [open] и вешает класс ul.dropdown; закрытие снимает [open].
	 * focusin/click-делегирование не покрывало бы клавиатурное открытие
	 * стрелками, а события cbi-dropdown-open ui.js не генерирует.
	 * ---------------------------------------------------------------- */

	var observer = new MutationObserver(function(mutations) {
		for (var i = 0; i < mutations.length; i++) {
			var m = mutations[i];
			var sb = m.target;

			if (!(sb instanceof HTMLElement) ||
			    !sb.classList.contains('cbi-dropdown'))
				continue;
			if (m.attributeName !== 'open')
				continue;

			if (sb.hasAttribute('open')) {
				/* Комбо-кнопки (Save & Apply и пр.) — всегда 2 пункта,
				 * но страхуемся явно, как в ТЗ */
				if (sb.classList.contains('btn') ||
				    sb.classList.contains('cbi-button'))
					continue;

				setupFilter(sb);
			}
			else {
				/* Закрытие: убираем фильтр и возвращаем пунктам видимость.
				 * Повторное открытие получит свежее поле — состояние сброшено. */
				teardownFilter(sb);
			}
		}
	});

	observer.observe(document.documentElement, {
		subtree: true,
		attributes: true,
		attributeFilter: ['open']
	});

})();

/* L.require инстанцирует результат модуля как класс — возвращаем пустой,
 * инициализация уже выполнена IIFE выше (observer, обработчики). */
return baseclass.extend({
	__init__: function() {}
});
