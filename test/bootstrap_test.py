import hashlib
import importlib.util
import io
import json
import pathlib
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('bootstrap', pathlib.Path(__file__).resolve().parents[1] / 'plugin/bootstrap.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='echo-bootstrap-test-')
        self.addCleanup(self.temp.cleanup)
        self.base = pathlib.Path(self.temp.name)
        self.home = self.base / 'home'
        self.plugin = self.home / '.config/omarchy/plugins/local.echo-chamber'
        self.plugin.mkdir(parents=True)
        self.archive = self.base / 'release.tar.gz'
        installer = 'def install(root, home, source):\n    (home / "installed").write_text(str(root))\n'
        with tarfile.open(self.archive, 'w:gz') as bundle:
            for name, text in [('electron/electron', 'test'), ('application/app/main.cjs', 'test'), ('application/dist/index.html', 'test'), ('installer.py', installer)]:
                member = tarfile.TarInfo(name)
                contents = text.encode()
                member.size = len(contents)
                bundle.addfile(member, io.BytesIO(contents))
        self.asset = {'url': 'https://github.com/smstromb/echo-chamber-omarchy/releases/download/v0.1.1/echo-chamber-linux-x64.tar.gz', 'size': self.archive.stat().st_size, 'sha256': hashlib.sha256(self.archive.read_bytes()).hexdigest()}
        (self.plugin / 'runtime.json').write_text(json.dumps({'version': '0.1.1', 'linux-x64': self.asset}))
        for name, value in [('HERE', self.plugin), ('SOURCE', self.plugin), ('report', lambda *args: None)]:
            patcher = patch.object(module, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_install_reuses_verified_build_without_downloading_again(self):
        module.bootstrap(self.home, self.archive, start=False)
        first = (self.home / 'installed').read_text()
        self.archive.unlink()
        module.bootstrap(self.home, start=False)
        self.assertEqual((self.home / 'installed').read_text(), first)
        self.assertFalse(list((self.home / '.local/share/echo-chamber/builds').glob('.download-*')))

    def test_corrupt_download_does_not_replace_existing_app(self):
        (self.home / 'installed').write_text('previous-build')
        self.archive.write_bytes(b'x' * self.asset['size'])
        with self.assertRaisesRegex(ValueError, 'verification'):
            module.bootstrap(self.home, self.archive, start=False)
        self.assertEqual((self.home / 'installed').read_text(), 'previous-build')

    def test_setup_does_not_launch_or_restart_an_existing_app(self):
        with patch.object(module, 'running', return_value=True), patch.object(module.subprocess, 'Popen') as spawn, patch.dict(module.os.environ, {'XDG_RUNTIME_DIR': str(self.base)}):
            module.bootstrap(self.home, self.archive, start=True)
        spawn.assert_not_called()

    def test_truncated_download_is_rejected(self):
        self.archive.write_bytes(b'x')
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            module.verify_archive(self.archive, self.asset)

    def test_archive_cannot_escape_install_directory_or_add_links(self):
        for name, link in [('../escape', False), ('/absolute', False), ('symlink', True)]:
            with tarfile.open(self.archive, 'w:gz') as bundle:
                member = tarfile.TarInfo(name)
                if link:
                    member.type = tarfile.SYMTYPE
                    member.linkname = '/tmp'
                bundle.addfile(member)
            with self.assertRaisesRegex(ValueError, 'Invalid file'):
                module.extract_archive(self.archive, self.base / 'extract')
        self.assertFalse((self.base / 'escape').exists())

    def test_unsupported_platform_has_a_clear_error(self):
        with patch.object(module.platform, 'machine', return_value='aarch64'):
            with self.assertRaisesRegex(ValueError, 'Linux x86-64'):
                module.bootstrap(self.home, self.archive, start=False)


if __name__ == '__main__':
    unittest.main()
