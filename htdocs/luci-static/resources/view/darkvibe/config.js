'use strict';
'require view';
'require form';

return view.extend({
	render: function() {
		var m = new form.Map('darkvibe',
			_('DarkVibe Theme'),
			_('Accent color of the DarkVibe interface.'));

		var s = m.section(form.NamedSection, 'global', 'global', _('Appearance'));
		s.anonymous = true;

		var o = s.option(form.ListValue, 'accent', _('Accent color'));
		o.value('lime', _('Lime'));
		o.value('amber', _('Amber'));
		o.value('teal', _('Teal'));
		o.value('violet', _('Violet'));
		o.value('rose', _('Rose'));
		o.value('blue', _('Blue'));
		o.value('custom', _('Custom…'));
		o.default = 'violet';

		o = s.option(form.Value, 'custom_accent', _('Custom color'),
			_('Hex code, e.g. #c3ee7a. Used when «Custom» is selected.'));
		o.depends('accent', 'custom');
		o.placeholder = '#c3ee7a';
		o.validate = function(section_id, value) {
			if (value == null || value == '')
				return true;
			if (!/^#[0-9a-fA-F]{6}$/.test(value))
				return _('Expected a hex color like #c3ee7a');
			return true;
		};

		return m.render();
	}
});
