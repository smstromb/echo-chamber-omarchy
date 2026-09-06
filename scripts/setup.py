#!/usr/bin/env python3
"""Build the companion outside Omarchy's git-managed plugin directory."""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import tempfile
from install import install

SOURCE = pathlib.Path(__file__).resolve().parent.parent
# Include only distributable app/build inputs, never profiles, logs or test captures.
INPUTS = ['app', 'src', 'plugin', 'bin', 'scripts/build.mjs', 'package.json', 'package-lock.json']


def setup(home):
    for command in ['node', 'npm', 'python3']:
        if not shutil.which(command):
            raise SystemExit(f'{command} is required. See README.md prerequisites.')
    major = int(subprocess.check_output(['node', '-p', 'process.versions.node.split(".")[0]'], text=True).strip())
    if major < 22:
        raise SystemExit('Node 22 or later is required.')
    home = pathlib.Path(home).resolve()
    digest = hashlib.sha256()
    files = sorted(p for name in INPUTS for p in ([SOURCE / name] if (SOURCE / name).is_file() else (SOURCE / name).rglob('*')) if p.is_file() and '__pycache__' not in p.parts)
    for p in files:
        digest.update(str(p.relative_to(SOURCE)).encode() + b'\0' + p.read_bytes())
    version = json.loads((SOURCE / 'package.json').read_text())['version']
    versions = home / '.local/share/echo-chamber/builds'
    versions.mkdir(parents=True, exist_ok=True)
    target = versions / f'{version}-{digest.hexdigest()[:16]}'
    if not (target / '.complete').exists():
        stage = pathlib.Path(tempfile.mkdtemp(prefix='.build-', dir=versions))
        try:
            for p in files:
                dest = stage / p.relative_to(SOURCE)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(p, dest)
            subprocess.run(['npm', 'ci', '--include=dev', '--no-fund', '--no-audit'], cwd=stage, check=True)
            subprocess.run(['npm', 'run', 'build'], cwd=stage, check=True)
            (stage / '.complete').write_text('built\n')
            stage.rename(target)
        except BaseException:
            shutil.rmtree(stage, ignore_errors=True)
            raise
    install(target, home, source=SOURCE)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', type=pathlib.Path, default=pathlib.Path.home(), help='Installation home (for isolated testing)')
    args = parser.parse_args()
    setup(args.home)
