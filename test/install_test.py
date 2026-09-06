import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('echo_install', pathlib.Path(__file__).resolve().parents[1] / 'scripts/install.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InstallationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='echo-installer-test-')
        self.addCleanup(self.temp.cleanup)
        self.home = pathlib.Path(self.temp.name) / 'home with spaces'
        self.root = pathlib.Path(self.temp.name) / 'app with spaces'
        for directory in ['dist', 'bin', 'plugin']:
            (self.root / directory).mkdir(parents=True)
        (self.root / 'dist/index.html').write_text('test')
        for name in ['manifest.json', 'Status.js', 'Panel.qml', 'echo-chamber-ctl']:
            (self.root / 'plugin' / name).write_text('test')
        (self.root / 'bin/echo-chamber-ctl').write_text('#!/usr/bin/env python3\n')
        (self.root / 'bin/echo-chamber-ctl').chmod(0o755)
        self.defaults = pathlib.Path(self.temp.name) / 'defaults.json'
        self.defaults.write_text(json.dumps({'bar': {'layout': {'right': [{'id': 'omarchy.tray'}, {'id': 'omarchy.audio'}]}}}))
        self.shell = self.home / '.config/omarchy/shell.json'

    def install(self, source=None):
        module.install(self.root, self.home, source=source, defaults=self.defaults)

    def test_fresh_install_preserves_default_widgets_and_is_idempotent(self):
        self.install()
        first = self.shell.read_text()
        self.install()
        self.assertEqual(self.shell.read_text(), first)
        self.assertEqual([x['id'] for x in json.loads(first)['bar']['layout']['right']], ['omarchy.tray', 'local.echo-chamber', 'omarchy.audio'])
        launcher = (self.home / '.local/bin/echo-chamber').read_text()
        self.assertIn("'" + str(self.root) + "'", launcher)
        self.assertIn('--background', (self.home / '.config/autostart/echo-chamber.desktop').read_text())

    def test_custom_configuration_and_backup_survive_install(self):
        self.shell.parent.mkdir(parents=True)
        original = {'idle': {'lock': 1234}, 'bar': {'layout': {'left': [{'id': 'local.custom'}], 'right': [{'id': 'omarchy.audio', 'custom': True}]}}}
        self.shell.write_text(json.dumps(original))
        self.install()
        updated = json.loads(self.shell.read_text())
        self.assertEqual(updated['idle'], original['idle'])
        self.assertEqual(updated['bar']['layout']['left'], original['bar']['layout']['left'])
        self.assertEqual(updated['bar']['layout']['right'][0], original['bar']['layout']['right'][0])
        backups = list(self.shell.parent.glob('shell.json.bak.echo-*'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads(backups[0].read_text()), original)
        self.install()
        self.assertEqual(len(list(self.shell.parent.glob('shell.json.bak.echo-*'))), 1)

    def test_native_plugin_checkout_is_not_overwritten_by_flat_manifest(self):
        plugin = self.home / '.config/omarchy/plugins/local.echo-chamber'
        (plugin / '.git').mkdir(parents=True)
        manifest = plugin / 'manifest.json'
        manifest.write_text('{"entryPoints":{"barWidget":"plugin/Panel.qml"}}')
        self.install(source=plugin)
        self.assertIn('plugin/Panel.qml', manifest.read_text())
        self.assertFalse((plugin / 'Panel.qml').exists())
        with self.assertRaises(SystemExit):
            self.install(source=self.root)

    def test_invalid_configuration_is_rejected_before_installation(self):
        self.shell.parent.mkdir(parents=True)
        self.shell.write_text('not json')
        with self.assertRaises(json.JSONDecodeError):
            self.install()
        self.assertFalse((self.home / '.local/bin/echo-chamber').exists())


if __name__ == '__main__':
    unittest.main()
