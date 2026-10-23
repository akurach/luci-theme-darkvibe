'use strict';
'require baseclass';
'require ui';
'require uci';

/**
 * DarkVibe — фоновое применение настроек (ТЗ §2) + ревизия изменений (ТЗ §1).
 *
 * Патчим (LuCI 25.292.66247~75e41cb, ui.js / luci.js роутера):
 *   - ui.changes.apply        — точка входа «Save & Apply» / «Apply unchecked»
 *     (вызывается из View.handleSaveApply в luci.js и из штатной модалки
 *     изменений). Штатная версия показывает блокирующую модалку прогресса;
 *     мы заменяем UI-слой на фоновый конвейер с индикатором в шапке.
 *     Конвейер бэкенда сохранён: POST admin/uci/apply_rollback|apply_unchecked,
 *     затем polling POST admin/uci/confirm до дедлайна, при потере связи —
 *     ожидание авто-отката (uci apply с rollback).
 *   - ui.changes.setIndicator — штатный счётчик «Unsaved Changes» в #indicators;
 *     заменяем на чип «Изменений: N» со своей diff-модалкой.
 *   - ui.changes.revert       — чтобы штатные точки (если останутся) тоже
 *     работали через наши тосты.
 *
 * Отличия от буквального ТЗ (адаптация к реальной версии, зафиксировано
 * в отчёте):
 *   - ubus-методов luci.getChanges / luci.getApplyStatus в этой сборке нет
 *     (rpcd-mod-luci 20240305). Changeset берём штатным ubus «uci changes»
 *     (uci.changes() из uci.js). Статус apply между страницами храним в
 *     sessionStorage и при загрузке новой страницы возобновляем polling
 *     confirm — это точнее, чем опрос getApplyStatus из ТЗ.
 *   - «Было» для обычных set-изменений недоступно: формат ubus «uci changes»
 *     содержит только новые значения (штатная модалка LuCI тоже показывает
 *     только «стало»). Где старое значение присутствует (list-del, rename,
 *     remove) — показываем его.
 *
 * Защита: любое исключение в нашем коде → откат к оригинальной функции.
 */

(function() {

	/* ------------------------------------------------------------------
	 * Оригиналы — сохраняем до патча, используем как фолбэк
	 * ---------------------------------------------------------------- */

	var ORIG = {
		apply: ui.changes.apply,
		revert: ui.changes.revert,
		setIndicator: ui.changes.setIndicator,
		displayChanges: ui.changes.displayChanges
	};

	/* ------------------------------------------------------------------
	 * Таймауты — берём из env LuCI (те же, что использует штатный код;
	 * сервер уже клампит: rollback >= 90, holdoff >= 1, timeout >= 1)
	 * ---------------------------------------------------------------- */

	var APPLY_ROLLBACK = Math.max(+L.env.apply_rollback || 90, 10) * 1000;
	var APPLY_HOLDOFF  = Math.max(+L.env.apply_holdoff  || 4,  1) * 1000;
	var APPLY_TIMEOUT  = Math.max(+L.env.apply_timeout  || 5,  1) * 1000;
	var APPLY_DISPLAY  = Math.max(+L.env.apply_display  || 1.5, 1) * 1000;

	var STORAGE_KEY = 'dv-apply';
	var POLL_MS = 1000;          /* период polling confirm (как в штатном коде) */
	var CHANGES_POLL_MS = 5000;  /* период обновления чипа изменений */
	var VAL_CUT = 48;            /* длина значения до обрезки многоточием */

	/* ------------------------------------------------------------------
	 * Состояние фонового apply
	 * ---------------------------------------------------------------- */

	var state = {
		applying: false,      /* идёт apply */
		phase: 'idle',        /* idle | request | confirm | rollback */
		checked: true,        /* apply с проверкой связи (rollback-окно) */
		startedAt: 0,         /* Date.now() старта (для счётчика секунд) */
		deadline: 0,          /* дедлайн текущей фазы */
		confirmAuth: null,    /* {token:...} из apply_rollback или null */
		pollAt: 0,            /* когда слать следующий confirm-запрос */
		pollInflight: false,  /* защита от наложения запросов */
		timer: null,          /* setInterval тикера */
		log: []               /* журнал для разворачиваемого лога в тосте */
	};

	function slog(msg) {
		var t = new Date();
		var hh = ('0' + t.getHours()).slice(-2);
		var mm = ('0' + t.getMinutes()).slice(-2);
		var ss = ('0' + t.getSeconds()).slice(-2);
		state.log.push('[%s:%s:%s] %s'.format(hh, mm, ss, msg));
		if (state.log.length > 200)
			state.log.splice(0, state.log.length - 200);
	}

	function persist() {
		try {
			if (state.applying) {
				sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
					checked: state.checked,
					startedAt: state.startedAt,
					deadline: state.deadline,
					confirmAuth: state.confirmAuth
				}));
			}
			else {
				sessionStorage.removeItem(STORAGE_KEY);
			}
		}
		catch (e) { /* sessionStorage может быть недоступен — не критично */ }
	}

	/* ------------------------------------------------------------------
	 * HTTP-обёртка: штатные точки dispatcher'а, авторизация через
	 * sid/token в query (ровно как в ui.js)
	 * ---------------------------------------------------------------- */

	function uciPost(action, auth) {
		var url = L.url('admin/uci', action);
		var q = {};

		if (auth && auth.token)
			q.token = auth.token;
		else {
			q.sid = L.env.sessionid;
			q.token = L.env.token;
		}

		var qs = Object.keys(q).map(function(k) {
			return '%s=%s'.format(encodeURIComponent(k), encodeURIComponent(q[k]));
		}).join('&');

		return fetch(url + '?' + qs, { method: 'POST', cache: 'no-store' }).then(
			function(res) { return { status: res.status, res: res }; },
			function() { return { status: 0, res: null }; }
		);
	}

	/* ------------------------------------------------------------------
	 * Индикатор и чип в шапке (.main-right header .fill)
	 * ---------------------------------------------------------------- */

	function statusBox() {
		var fill = document.querySelector('.main-right header .fill');
		if (!fill)
			return null;

		var box = fill.querySelector('.dv-status');
		if (!box) {
			box = E('div', { 'class': 'dv-status' });
			fill.appendChild(box);
		}

		return box;
	}

	/* Спиннер + «Применяется… (N с)» */
	function showIndicator(text) {
		var box = statusBox();
		if (!box)
			return;

		var ind = box.querySelector('.dv-applying-ind');
		if (!ind) {
			ind = E('span', { 'class': 'dv-applying-ind' }, [
				E('span', { 'class': 'dv-spinner', 'aria-hidden': 'true' }),
				E('span', { 'class': 'dv-applying-text' })
			]);
			box.appendChild(ind);
		}

		ind.querySelector('.dv-applying-text').textContent = text || '';
	}

	function setIndicatorText(text) {
		var ind = document.querySelector('.dv-status .dv-applying-ind');
		if (ind)
			ind.querySelector('.dv-applying-text').textContent = text || '';
	}

	function hideIndicator() {
		var ind = document.querySelector('.dv-status .dv-applying-ind');
		if (ind && ind.parentNode)
			ind.parentNode.removeChild(ind);
	}

	/* Чип «Изменений: N» */
	function setChip(n) {
		var box = statusBox();
		if (!box)
			return;

		var chip = box.querySelector('.dv-chip');
		if (n > 0) {
			if (!chip) {
				chip = E('button', {
					'class': 'dv-chip',
					'title': _('Показать изменения перед применением'),
					'click': function() { openDiffModal(); }
				});
				/* чип — перед индикатором apply */
				box.insertBefore(chip, box.firstChild);
			}
			chip.textContent = _('Изменений: %d').format(n);
		}
		else if (chip && chip.parentNode) {
			chip.parentNode.removeChild(chip);
		}
	}

	/* ------------------------------------------------------------------
	 * Тосты (зелёный «Применено» / красный с разворачиваемым логом)
	 * ---------------------------------------------------------------- */

	function toast(kind, title, opts) {
		opts = opts || {};

		var box = document.querySelector('.dv-toasts');
		if (!box) {
			box = E('div', { 'class': 'dv-toasts' });
			document.body.appendChild(box);
		}

		var children = [ E('div', { 'class': 'dv-toast-title' }, [ title ]) ];

		if (opts.text)
			children.push(E('div', { 'class': 'dv-toast-text' }, [ opts.text ]));

		if (opts.log && opts.log.length) {
			children.push(E('details', { 'class': 'dv-toast-log' }, [
				E('summary', {}, [ _('Журнал') ]),
				E('pre', {}, [ opts.log.join('\n') ])
			]));
		}

		children.push(E('button', {
			'class': 'dv-toast-close',
			'title': _('Закрыть'),
			'click': function(ev) { dismissToast(ev.target); }
		}, [ '×' ]));

		var el = E('div', { 'class': 'dv-toast dv-toast-%s'.format(kind) }, children);
		box.appendChild(el);

		var ttl = (kind === 'error') ? 15000 : 4000;
		setTimeout(function() { dismissToast(el); }, ttl);

		/* не копим больше пяти тостов */
		while (box.children.length > 5)
			box.removeChild(box.firstChild);
	}

	function dismissToast(el) {
		var node = el.classList ? el : el.closest('.dv-toast');
		if (!node || !node.parentNode)
			return;
		node.classList.add('dv-toast-out');
		setTimeout(function() {
			if (node.parentNode)
				node.parentNode.removeChild(node);
		}, 250);
	}

	function microToast(text) {
		var box = document.querySelector('.dv-toasts');
		if (!box) {
			box = E('div', { 'class': 'dv-toasts' });
			document.body.appendChild(box);
		}

		var el = E('div', { 'class': 'dv-toast dv-toast-micro' }, [ text ]);
		box.appendChild(el);
		setTimeout(function() { dismissToast(el); }, 1500);
	}

	/* ------------------------------------------------------------------
	 * Дизейбл кнопок Save/Apply на время apply
	 * ---------------------------------------------------------------- */

	function setApplying(on) {
		document.body.classList.toggle('dv-applying', on);

		var btns = document.querySelectorAll(
			'.cbi-page-actions .cbi-button-apply, ' +
			'.cbi-page-actions .cbi-button-save, ' +
			'.cbi-page-actions .cbi-button-positive'
		);

		for (var i = 0; i < btns.length; i++)
			btns[i].disabled = on;
	}

	/* ------------------------------------------------------------------
	 * Тикер: счётчик секунд, дедлайны фаз, расписание polling confirm
	 * ---------------------------------------------------------------- */

	function startTicker() {
		stopTicker();
		state.timer = setInterval(tick, POLL_MS);
	}

	function stopTicker() {
		if (state.timer) {
			clearInterval(state.timer);
			state.timer = null;
		}
	}

	function tick() {
		try {
			var now = Date.now();
			var secs = Math.max(Math.floor((now - state.startedAt) / 1000), 0);

			if (state.phase === 'request') {
				setIndicatorText(_('Применяется… (%d с)').format(secs));
			}
			else if (state.phase === 'confirm') {
				setIndicatorText(_('Применяется… (%d с)').format(secs));

				if (now >= state.deadline) {
					/* ТЗ: таймаут 90 с → ошибка. Бэкенд в это время сам
					 * начинает откат; продолжаем ждать подтверждения отката. */
					slog('дедлайн подтверждения истёк, ожидание отката');
					toast('error', _('Применение не завершилось'),
						{ text: _('Проверьте журнал'), log: state.log });
					state.phase = 'rollback';
					state.deadline = now + APPLY_ROLLBACK;
					persist();
				}
			}
			else if (state.phase === 'rollback') {
				setIndicatorText(_('Откат изменений… (%d с)').format(secs));

				if (now >= state.deadline) {
					slog('откат не подтверждён, устройство недоступно');
					finishError(_('Устройство недоступно'),
						_('Не удалось восстановить связь с устройством после применения изменений. Возможно, потребуется переподключение.'),
						false);
				}
			}

			if ((state.phase === 'confirm' || state.phase === 'rollback') &&
			    now >= state.pollAt && !state.pollInflight) {
				state.pollAt = now + POLL_MS;
				pollConfirm();
			}
		}
		catch (e) {
			/* тикер не должен уронить страницу — при сбое просто останавливаемся */
			console.warn('dv-apply: tick failed, falling back to stock apply UI', e);
			stopTicker();
			finishError(_('Ошибка интерфейса'), String(e && e.message || e), false);
		}
	}

	/* ------------------------------------------------------------------
	 * Polling admin/uci/confirm (штатная механика: 200/204 = применено;
	 * в фазе отката 204 = откат подтверждён)
	 * ---------------------------------------------------------------- */

	function pollConfirm() {
		state.pollInflight = true;

		uciPost('confirm', state.confirmAuth).then(function(r) {
			state.pollInflight = false;
			var now = Date.now();

			if (r.status === 200 || r.status === 204) {
				if (state.phase === 'rollback') {
					slog('откат подтверждён сервером');
					finishError(_('Изменения откачены'),
						_('Устройство не подтвердило применение в течение отведённого времени, конфигурация возвращена к прежнему состоянию.'),
						true);
				}
				else {
					slog('применение подтверждено сервером');
					finishSuccess();
				}
				return;
			}

			slog('confirm: статус %d, повтор'.format(r.status));

			if (state.phase === 'confirm' && now >= state.deadline) {
				/* переход в rollback обработает тикер */
			}
			else if (state.phase === 'rollback' && now >= state.deadline) {
				/* финальная ошибка обработает тикер */
			}
		});
	}

	/* ------------------------------------------------------------------
	 * Финалы конвейера
	 * ---------------------------------------------------------------- */

	function finishSuccess() {
		state.applying = false;
		state.phase = 'idle';
		stopTicker();
		persist();
		hideIndicator();
		setApplying(false);

		slog('готово');
		toast('success', _('Применено'));

		/* штатное поведение: сброс счётчика и событие для форм */
		try {
			ui.changes.setIndicator(0);
			document.dispatchEvent(new CustomEvent('uci-applied'));
		}
		catch (e) { }

		/* на страницах с формами перезагружаем view, как штатный код,
		 * чтобы формы показали применённые значения */
		if (document.querySelector('#maincontent .cbi-map')) {
			setTimeout(function() {
				window.location = window.location.href.split('#')[0];
			}, APPLY_DISPLAY);
		}
	}

	function finishError(title, text, offerActions) {
		state.applying = false;
		state.phase = 'idle';
		stopTicker();
		persist();
		hideIndicator();
		setApplying(false);

		toast('error', title, { text: text, log: state.log });

		if (offerActions)
			showApplyUncheckedModal(title, text);
	}

	/* Модалка после отката: что делать дальше (как в штатном rollback) */
	function showApplyUncheckedModal(title, text) {
		try {
			ui.showModal(title, [
				E('p', {}, [ text ]),
				E('div', { 'class': 'button-row' }, [
					E('button', {
						'class': 'btn cbi-button',
						'click': function() { ui.hideModal(); }
					}, [ _('Закрыть') ]),
					' ',
					E('button', {
						'class': 'btn cbi-button cbi-button-reset',
						'click': function() {
							ui.hideModal();
							revertChanges();
						}
					}, [ _('Откатить изменения') ]),
					' ',
					E('button', {
						'class': 'btn cbi-button cbi-button-negative important',
						'click': function() {
							ui.hideModal();
							startApply(false);
						}
					}, [ _('Применить без проверки') ])
				])
			]);
		}
		catch (e) {
			console.warn('dv-apply: actions modal failed', e);
		}
	}

	/* ------------------------------------------------------------------
	 * Запуск фонового apply — замена ui.changes.apply
	 * ---------------------------------------------------------------- */

	function startApply(checked) {
		if (state.applying) {
			microToast(_('Применение уже выполняется'));
			return Promise.resolve();
		}

		state.applying = true;
		state.checked = !!checked;
		state.phase = 'request';
		state.startedAt = Date.now();
		state.deadline = 0;
		state.confirmAuth = null;
		state.pollAt = 0;
		state.log = [];

		slog(checked
			? 'запуск apply (с проверкой связи)'
			: 'запуск apply (без проверки)');
		showIndicator(_('Применяется… (0 с)'));
		setApplying(true);
		persist();
		startTicker();

		/* Шаг 1 (только checked): штатная проверка, не рвёт ли связь
		 * изменение сети. Предупреждаем модалкой, но не блокируем
		 * остальной интерфейс. */
		var checkedPromise = Promise.resolve(checked);

		if (checked) {
			checkedPromise = ui.changes.checkConnectivityAffected().then(function(affected) {
				if (!affected)
					return true;

				slog('изменения затрагивают текущий интерфейс связи: %s'.format(affected));

				return new Promise(function(resolve, reject) {
					ui.showModal(_('Изменение связности'), [
						E('p', {}, [ _('Изменения затрагивают текущее соединение (%h). Если адрес устройства сменится, доступ нужно будет восстановить в течение %d с, иначе конфигурация откатится.').format(affected, Math.round(APPLY_ROLLBACK / 1000)) ]),
						E('div', { 'class': 'button-row' }, [
							E('button', {
								'class': 'btn cbi-button',
								'click': function() {
									ui.hideModal();
									reject(new Error('cancelled'));
								}
							}, [ _('Отмена') ]),
							' ',
							E('button', {
								'class': 'btn cbi-button cbi-button-negative important',
								'click': function() {
									ui.hideModal();
									resolve(false);
								}
							}, [ _('Применить без проверки') ]),
							' ',
							E('button', {
								'class': 'btn cbi-button cbi-button-action important',
								'click': function() {
									ui.hideModal();
									resolve(true);
								}
							}, [ _('Применить с откатом при потере связи') ])
						])
					]);
				});
			}, function() { return true; });
		}

		return checkedPromise.then(function(useChecked) {
			state.checked = !!useChecked;
			persist();

			/* Шаг 2: собственно apply на бэке */
			return uciPost(useChecked ? 'apply_rollback' : 'apply_unchecked', null);
		}).then(function(r) {
			if (state.checked && r.status === 200) {
				var tok = null;
				try { tok = r.res.json().token; } catch (e) { }
				state.confirmAuth = tok ? { token: tok } : null;
				slog('apply принят сервером, токен подтверждения получен');
				beginConfirm();
			}
			else if (state.checked && r.status === 204) {
				slog('нет изменений для применения');
				state.applying = false;
				state.phase = 'idle';
				stopTicker();
				persist();
				hideIndicator();
				setApplying(false);
				toast('success', _('Нет изменений для применения'));
			}
			else if (!state.checked && r.status === 204) {
				slog('apply без проверки выполнен сервером');
				finishSuccess();
			}
			else {
				slog('apply отклонён, статус %d'.format(r.status));
				throw new Error('HTTP %d'.format(r.status));
			}
		}).catch(function(err) {
			if (err && err.message === 'cancelled') {
				slog('apply отменён пользователем');
				state.applying = false;
				state.phase = 'idle';
				stopTicker();
				persist();
				hideIndicator();
				setApplying(false);
				return;
			}

			slog('ошибка запроса apply: %s'.format(err && err.message || err));
			finishError(_('Ошибка применения'),
				_('Сервер отклонил запрос на применение изменений.'), false);
		});
	}

	/* Шаг 3: окно подтверждения — polling admin/uci/confirm до дедлайна */
	function beginConfirm() {
		state.phase = 'confirm';
		state.deadline = Date.now() + APPLY_ROLLBACK;
		state.pollAt = Date.now() + APPLY_HOLDOFF;
		persist();
		startTicker();
	}

	/* ------------------------------------------------------------------
	 * Возврат на другую страницу во время apply: статус живёт в
	 * sessionStorage, при загрузке модуля на новой странице конвейер
	 * возобновляется с того же дедлайна
	 * ---------------------------------------------------------------- */

	function resume() {
		var saved = null;

		try { saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null'); }
		catch (e) { saved = null; }

		if (!saved || !saved.startedAt)
			return;

		var now = Date.now();
		var maxAge = now - (APPLY_ROLLBACK * 2 + APPLY_HOLDOFF);

		if (saved.startedAt < maxAge) {
			/* протухло безвозвратно — чистим и показываем ошибку,
			 * чтобы она не потерялась при возврате (критерий ТЗ §2.3) */
			persist();
			try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { }
			toast('error', _('Применение не завершилось'),
				{ text: _('Проверьте журнал системы') });
			return;
		}

		state.applying = true;
		state.checked = !!saved.checked;
		state.startedAt = saved.startedAt;
		state.confirmAuth = saved.confirmAuth || null;
		state.log = [ '[dv-apply] состояние восстановлено после перехода на другую страницу' ];

		/* фазу восстанавливаем по дедлайну: если окно подтверждения ещё
		 * не истекло — продолжаем confirm, иначе ждём откат */
		if (now < saved.deadline) {
			state.phase = 'confirm';
			state.deadline = saved.deadline;
		}
		else {
			state.phase = 'rollback';
			state.deadline = now + Math.min(APPLY_ROLLBACK, 30000);
		}

		state.pollAt = 0;
		showIndicator(_('Применяется… (%d с)').format(
			Math.max(Math.floor((now - state.startedAt) / 1000), 0)));
		setApplying(true);
		startTicker();
	}

	/* ------------------------------------------------------------------
	 * ТЗ §1: чип «Изменений: N» + diff-модалка
	 * ---------------------------------------------------------------- */

	function countChanges(changes) {
		var n = 0;
		for (var config in changes)
			if (changes.hasOwnProperty(config) && Array.isArray(changes[config]))
				n += changes[config].length;
		return n;
	}

	/* Формат changeset (ubus «uci changes», зафиксирован по ui.js):
	 *   { "<config>": [ [opcode, ...args], ... ] }
	 * opcode и аргументы (индексация как в changeTemplates ui.js):
	 *   add        [name, type]            — новая анонимная секция
	 *   set        [section, type]         — создание именованной секции
	 *   set        [section, option, val]  — установка опции
	 *   remove     [section]               — удаление секции
	 *   remove     [section, option]       — удаление опции
	 *   order      [section, position]
	 *   list-add   [section, option, value]
	 *   list-del   [section, option, value]
	 *   rename     [section, newname] | rename [section, option, newname]
	 * Старые значения в формате отсутствуют (см. шапку файла). */

	function fmtVal(v) {
		if (v == null || v === '')
			return '—';
		var s = String(v);
		if (s.length > VAL_CUT)
			s = s.slice(0, VAL_CUT) + '…';
		return s;
	}

	function valCell(v, mono) {
		if (v == null || v === '')
			return E('span', { 'class': 'dv-val dv-val-empty' }, [ '—' ]);

		var s = String(v);
		var attrs = {
			'class': 'dv-val' + (mono ? ' dv-val-mono' : ''),
			'title': s.length > VAL_CUT ? s : null,
			'click': function() { copyValue(s); }
		};
		return E('span', attrs, [ fmtVal(s) ]);
	}

	function copyValue(s) {
		var done = function() { microToast(_('Скопировано')); };

		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(s).then(done, function() { legacyCopy(s, done); });
		}
		else {
			legacyCopy(s, done);
		}
	}

	function legacyCopy(s, done) {
		try {
			var ta = E('textarea', { 'style': 'position:fixed;opacity:0' });
			document.body.appendChild(ta);
			ta.value = s;
			ta.select();
			document.execCommand('copy');
			ta.parentNode.removeChild(ta);
			done();
		}
		catch (e) { }
	}

	/* Одна строка diff: секция / опция / было / стало */
	function diffRow(section, option, oldVal, newVal, oldMono, newMono) {
		return E('tr', {}, [
			E('td', { 'class': 'dv-diff-sect' }, [ String(section) ]),
			E('td', {}, [ option != null ? String(option) : '—' ]),
			E('td', {}, [ valCell(oldVal, oldMono) ]),
			E('td', {}, [ valCell(newVal, newMono) ])
		]);
	}

	function buildDiffRows(config, list) {
		var rows = [];
		var added = null; /* последняя add-секция для @type[-1] */

		for (var i = 0; i < list.length; i++) {
			var chg = list[i];
			var op = chg[0];

			switch (op) {
			case 'add':
				rows.push(diffRow('@' + chg[2] + '[-1]', null, null,
					_('новая секция типа «%s»').format(chg[2])));
				added = [ chg[1], chg[2] ];
				break;

			case 'set':
				if (chg.length === 3) {
					var sect = (added && chg[1] === added[0])
						? '@' + added[1] + '[-1]' : chg[1];
					rows.push(diffRow(sect, null, null,
						_('создана секция типа «%s»').format(chg[2])));
				}
				else {
					var sect2 = (added && chg[1] === added[0])
						? '@' + added[1] + '[-1]' : chg[1];
					rows.push(diffRow(sect2, chg[2], null, chg[3], false, true));
				}
				break;

			case 'remove':
				if (chg.length === 2)
					rows.push(diffRow(chg[1], null, _('секция'), null));
				else
					rows.push(diffRow(chg[1], chg[2], _('задано'), null));
				break;

			case 'order':
				rows.push(diffRow(chg[1], null, null, _('позиция %s').format(chg[2])));
				break;

			case 'list-add':
				rows.push(diffRow(chg[1], chg[2], null, chg[3], false, true));
				break;

			case 'list-del':
				rows.push(diffRow(chg[1], chg[2], chg[3], null, true, false));
				break;

			case 'rename':
				if (chg.length === 3)
					rows.push(diffRow(chg[1], null, chg[1], chg[2]));
				else
					rows.push(diffRow(chg[1], null, chg[2], chg[3]));
				break;

			default:
				rows.push(diffRow(chg[1] != null ? chg[1] : '?', null, null,
					('%s: %s'.format(op, chg.slice(1).join(', ')))));
				break;
			}
		}

		return rows;
	}

	function openDiffModal() {
		fetchChanges().then(function(changes) {
			var n = countChanges(changes);

			if (n === 0) {
				setChip(0);
				return;
			}

			var body = [];

			for (var config in changes) {
				if (!changes.hasOwnProperty(config) || !Array.isArray(changes[config]))
					continue;

				body.push(E('h5', { 'class': 'dv-diff-cfg' },
					[ '/etc/config/%s'.format(config) ]));

				var table = E('table', { 'class': 'dv-diff-table' }, [
					E('tr', {}, [
						E('th', {}, [ _('Секция') ]),
						E('th', {}, [ _('Опция') ]),
						E('th', {}, [ _('Было') ]),
						E('th', {}, [ _('Стало') ])
					])
				]);

				var rows = buildDiffRows(config, changes[config]);
				for (var i = 0; i < rows.length; i++)
					table.appendChild(rows[i]);

				body.push(table);
			}

			body.push(E('p', { 'class': 'dv-diff-hint' }, [
				_('Клик по значению копирует его в буфер обмена.')
			]));

			body.push(E('div', { 'class': 'button-row' }, [
				E('button', {
					'class': 'btn cbi-button',
					'click': function() { ui.hideModal(); }
				}, [ _('Закрыть') ]),
				' ',
				E('button', {
					'class': 'btn cbi-button cbi-button-reset',
					'click': function() {
						ui.hideModal();
						revertChanges();
					}
				}, [ _('Откатить') ]),
				' ',
				E('button', {
					'class': 'btn cbi-button cbi-button-apply important',
					'disabled': state.applying || null,
					'click': function() {
						ui.hideModal();
						startApply(true);
					}
				}, [ state.applying ? _('Применяется…') : _('Применить') ])
			]));

			ui.showModal(_('Изменения конфигурации'), body);
		});
	}

	function fetchChanges() {
		return uci.changes().then(function(r) {
			if (r && r.changes && !Array.isArray(r.changes))
				return r.changes;

			/* uci.changes() с expect:{changes:{}} отдаёт объект напрямую */
			if (r && !Array.isArray(r) && typeof r === 'object')
				return r;

			return {};
		}, function() { return {}; });
	}

	/* ------------------------------------------------------------------
	 * Откат (ТЗ §1): POST admin/uci/revert, затем перезагрузка view —
	 * как штатный код (без перезагрузки формы останутся показывать
	 * откаченные значения)
	 * ---------------------------------------------------------------- */

	function revertChanges() {
		slog('запрос отката изменений');

		return uciPost('revert', null).then(function(r) {
			if (r.status === 200 || r.status === 204) {
				toast('success', _('Изменения откачены'));

				try {
					ui.changes.setIndicator(0);
					document.dispatchEvent(new CustomEvent('uci-reverted'));
				}
				catch (e) { }

				setTimeout(function() {
					window.location = window.location.href.split('#')[0];
				}, APPLY_DISPLAY);
			}
			else {
				toast('error', _('Не удалось откатить изменения'),
					{ text: 'HTTP %d'.format(r.status) });
			}
		});
	}

	/* ------------------------------------------------------------------
	 * Monkey-patch с фолбэком на оригинал
	 * ---------------------------------------------------------------- */

	ui.changes.apply = function(checked) {
		try {
			return startApply(!!checked);
		}
		catch (e) {
			console.warn('dv-apply: fallback to stock ui.changes.apply', e);
			return ORIG.apply.call(ui.changes, checked);
		}
	};

	ui.changes.revert = function() {
		try {
			return revertChanges();
		}
		catch (e) {
			console.warn('dv-apply: fallback to stock ui.changes.revert', e);
			return ORIG.revert.call(ui.changes);
		}
	};

	ui.changes.setIndicator = function(n) {
		try {
			setChip(+n || 0);
		}
		catch (e) {
			console.warn('dv-apply: fallback to stock setIndicator', e);
			return ORIG.setIndicator.call(ui.changes, n);
		}
	};

	/* Чип также обновляем собственным поллером — штатный init вызывается
	 * только по событиям luci-loaded/uci-loaded, а изменения могут
	 * появиться из другой вкладки */
	setInterval(function() {
		fetchChanges().then(function(changes) {
			setChip(countChanges(changes));
			ui.changes.changes = changes;
		});
	}, CHANGES_POLL_MS);

	/* Возобновление apply после перехода на другую страницу */
	resume();

})();

/* L.require инстанцирует результат модуля как класс — возвращаем пустой,
 * инициализация уже выполнена IIFE выше (патчи, слушатели, polling). */
return baseclass.extend({
	__init__: function() {}
});
