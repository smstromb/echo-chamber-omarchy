#!/usr/bin/env python3
"""Package a built Linux x64 app and pin its release digest in the plugin."""
import hashlib
import json
import pathlib
import platform
import tarfile
import tempfile

root = pathlib.Path(__file__).resolve().parent.parent
if platform.system() != 'Linux' or platform.machine() != 'x86_64':
    raise SystemExit('Build this release on Linux x86-64.')
version = json.loads((root / 'package.json').read_text())['version']
output = root / 'artifacts/releases'
output.mkdir(parents=True, exist_ok=True)
archive = output / 'echo-chamber-linux-x64.tar.gz'
# Explicit inputs prevent profiles, tokens, development files or recordings
# entering the release. Electron keeps its own licenses and Chromium notices.
with tarfile.open(archive, 'w:gz', compresslevel=6, dereference=True) as bundle:
    for source, dest in [
        ('node_modules/electron/dist', 'electron'),
        ('app', 'application/app'),
        ('dist', 'application/dist'),
        ('bin', 'application/bin'),
        ('scripts/install.py', 'installer.py'),
        ('LICENSE', 'LICENSE'),
        ('THIRD-PARTY.md', 'THIRD-PARTY.md'),
    ]:
        bundle.add(root / source, arcname=dest, filter=lambda member: None if '__pycache__' in member.name or member.name.endswith('.log') else member)
    with tempfile.TemporaryDirectory() as directory:
        package = pathlib.Path(directory) / 'package.json'
        package.write_text(json.dumps({'name': 'echo-chamber-omarchy', 'version': version, 'main': 'app/main.cjs', 'license': 'MIT'}))
        bundle.add(package, arcname='application/package.json')
digest = hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()
manifest = {'version': version, 'linux-x64': {'url': f'https://github.com/smstromb/echo-chamber-omarchy/releases/download/v{version}/echo-chamber-linux-x64.tar.gz', 'sha256': digest, 'size': archive.stat().st_size}}
(root / 'plugin/runtime.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Packaged {archive.name}: {archive.stat().st_size} bytes, SHA-256 {digest}')
