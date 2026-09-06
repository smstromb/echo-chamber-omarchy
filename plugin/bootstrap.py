#!/usr/bin/env python3
"""Install the pinned desktop release when Omarchy enables the toolbar."""
import argparse
import contextlib
import fcntl
import hashlib
import importlib.util
import json
import os
import pathlib
import platform
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
SOURCE = HERE.parent if (HERE.parent / 'manifest.json').is_file() else HERE
MAX_ARCHIVE = 512 * 1024 * 1024


def report(status, message=''):
    print(json.dumps({'status': status, 'message': message}), flush=True)


def verify_archive(path, asset):
    if path.stat().st_size != asset['size']:
        raise ValueError('App download was incomplete. Retry setup.')
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    if digest.hexdigest() != asset['sha256']:
        raise ValueError('App download failed verification. Retry setup.')


def extract_archive(archive, destination):
    with tarfile.open(archive, 'r:gz') as bundle:
        members = bundle.getmembers()
        total = 0
        for member in members:
            path = pathlib.PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or not (member.isfile() or member.isdir()):
                raise ValueError('Invalid file in app download.')
            total += member.size
            if total > 1024 * 1024 * 1024:
                raise ValueError('App download exceeds its expected size.')
        bundle.extractall(destination, members=members, filter='data')


def running(socket_path):
    try:
        with socket.socket(socket.AF_UNIX) as connection:
            connection.settimeout(2)
            connection.connect(str(socket_path))
            connection.sendall(b'{"action":"status"}\n')
            data = connection.makefile('rb').readline(65536)
            return bool(json.loads(data).get('ok'))
    except (OSError, ValueError):
        return False


def bootstrap(home, archive=None, start=True):
    home = pathlib.Path(home).resolve()
    machine = platform.machine().lower()
    if platform.system() != 'Linux' or machine not in ['x86_64', 'amd64']:
        raise ValueError('This release requires Linux x86-64.')
    manifest = json.loads((HERE / 'runtime.json').read_text())
    asset = manifest['linux-x64']
    if not (0 < asset['size'] <= MAX_ARCHIVE) or len(asset['sha256']) != 64 or any(c not in '0123456789abcdef' for c in asset['sha256']):
        raise ValueError('Invalid app release metadata.')
    version = manifest['version']
    url = f'https://github.com/smstromb/echo-chamber-omarchy/releases/download/v{version}/echo-chamber-linux-x64.tar.gz'
    if asset['url'] != url:
        raise ValueError('Invalid app release location.')
    base = home / '.local/share/echo-chamber'
    base.mkdir(parents=True, exist_ok=True)
    with (base / 'install.lock').open('a') as lock:
        report('installing', 'Setting up Echo Chamber…')
        fcntl.flock(lock, fcntl.LOCK_EX)
        builds = base / 'builds'
        builds.mkdir(exist_ok=True)
        target = builds / ('release-' + asset['sha256'][:24])
        if not (target / '.complete').is_file():
            work = pathlib.Path(tempfile.mkdtemp(prefix='.download-', dir=builds))
            try:
                download = work / 'app.tar.gz'
                if archive:
                    shutil.copyfile(archive, download)
                else:
                    report('downloading', 'Downloading Echo Chamber…')
                    request = urllib.request.Request(url, headers={'User-Agent': 'echo-chamber-omarchy/' + version})
                    with urllib.request.urlopen(request, timeout=60) as response, download.open('wb') as output:
                        size = 0
                        for block in iter(lambda: response.read(1024 * 1024), b''):
                            size += len(block)
                            if size > asset['size']:
                                raise ValueError('App download exceeds its expected size.')
                            output.write(block)
                verify_archive(download, asset)
                report('installing', 'Installing Echo Chamber…')
                extracted = work / 'release'
                extracted.mkdir()
                extract_archive(download, extracted)
                for name in ['electron/electron', 'application/app/main.cjs', 'application/dist/index.html', 'installer.py']:
                    if not (extracted / name).is_file():
                        raise ValueError('App download is missing required files.')
                (extracted / '.complete').write_text(asset['sha256'] + '\n')
                extracted.rename(target)
            finally:
                shutil.rmtree(work, ignore_errors=True)
        spec = importlib.util.spec_from_file_location('echo_release_installer', target / 'installer.py')
        installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(installer)
        with contextlib.redirect_stdout(sys.stderr):
            installer.install(target / 'application', home, source=SOURCE)
        if start:
            runtime = os.environ.get('XDG_RUNTIME_DIR')
            if not runtime:
                raise ValueError('Desktop session unavailable. Sign in to Omarchy and retry.')
            socket_path = os.environ.get('ECHO_SOCKET_PATH', str(pathlib.Path(runtime) / 'echo-chamber.sock'))
            if not running(socket_path):
                logfile = base / 'app.log'
                descriptor = os.open(logfile, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
                with os.fdopen(descriptor, 'w') as log:
                    process = subprocess.Popen([str(home / '.local/bin/echo-chamber'), '--background'], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
                deadline = time.monotonic() + 15
                while not running(socket_path):
                    if process.poll() is not None or time.monotonic() >= deadline:
                        raise ValueError('App did not start. See ' + str(logfile))
                    time.sleep(0.2)
        report('ready')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', type=pathlib.Path, default=pathlib.Path.home())
    parser.add_argument('--archive', type=pathlib.Path, help=argparse.SUPPRESS)
    parser.add_argument('--no-start', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        bootstrap(args.home, args.archive, not args.no_start)
    except Exception as error:
        report('error', str(error))
        sys.exit(1)
