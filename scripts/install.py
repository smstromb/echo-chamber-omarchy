#!/usr/bin/env python3
"""Idempotent user-local integration; never restart an active call."""
import argparse
import copy
import datetime
import json
import pathlib
import shlex
import shutil

PLUGIN_ID = 'local.echo-chamber'


def install(root, home, source=None, defaults=None):
    root, home = pathlib.Path(root).resolve(), pathlib.Path(home).resolve()
    source = pathlib.Path(source).resolve() if source else root
    if not (root / 'dist/index.html').is_file():
        raise SystemExit('Build the desktop app first.')
    electron = root.parent / 'electron/electron'
    node = shutil.which('node')
    if electron.is_file():
        launch = [str(electron), str(root)]
    elif node:
        launch = [node, str(root / 'node_modules/electron/cli.js'), str(root)]
    else:
        raise SystemExit('Node 22 or later is required for a source build.')
    plugin = home / '.config/omarchy/plugins' / PLUGIN_ID
    if (plugin / '.git').exists() and plugin.resolve() != source:
        raise SystemExit(f'Run install.sh from the existing plugin checkout: {plugin}')
    shell = home / '.config/omarchy/shell.json'
    config = json.loads(shell.read_text()) if shell.exists() else {'version': 1}
    default_path = pathlib.Path(defaults or '/usr/share/omarchy/config/omarchy/shell.json')
    default_config = json.loads(default_path.read_text()) if default_path.exists() else {}
    layout = config.setdefault('bar', {}).setdefault('layout', {})
    entries = [x for section in layout.values() if isinstance(section, list) for x in section if isinstance(x, dict)]
    changed = not any(x.get('id') == PLUGIN_ID for x in entries)
    if changed:
        if 'right' not in layout:
            right = default_config.get('bar', {}).get('layout', {}).get('right')
            if right is None:
                raise SystemExit('Omarchy Quickshell defaults not found. This plugin requires the Quickshell bar.')
            layout['right'] = copy.deepcopy(right)
        layout['right'].insert(min(1, len(layout['right'])), {'id': PLUGIN_ID})
    # Validate all inputs before writing the desktop integration.
    bin_dir = home / '.local/bin'
    bin_dir.mkdir(parents=True, exist_ok=True)
    launcher = bin_dir / 'echo-chamber'
    launcher_text = '#!/bin/sh\nexec ' + shlex.join(launch) + ' "$@"\n'
    # Atomic replacement: an already-running app keeps its existing build.
    temporary_launcher = launcher.with_suffix('.tmp')
    temporary_launcher.write_text(launcher_text)
    temporary_launcher.chmod(0o755)
    temporary_launcher.replace(launcher)
    launcher.chmod(0o755)
    shutil.copy2(root / 'bin/echo-chamber-ctl', bin_dir / 'echo-chamber-ctl')
    if plugin.resolve() != source:
        plugin.mkdir(parents=True, exist_ok=True)
        for name in ['manifest.json', 'Status.js', 'Panel.qml', 'echo-chamber-ctl']:
            shutil.copy2(root / 'plugin' / name, plugin / name)
        for name in ['bootstrap.py', 'runtime.json']:
            if (root / 'plugin' / name).exists():
                shutil.copy2(root / 'plugin' / name, plugin / name)
    applications = home / '.local/share/applications'
    applications.mkdir(parents=True, exist_ok=True)
    # Desktop Entry Exec uses its own quoting rules (not shell quoting).
    exec_path = str(launcher).replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$').replace('%', '%%')
    desktop = '[Desktop Entry]\nType=Application\nName=Echo Chamber\nComment=Voice chat and screen sharing\nExec="' + exec_path + '"\nIcon=audio-headphones\nTerminal=false\nCategories=Network;AudioVideo;\nStartupWMClass=echo-chamber-omarchy\n'
    (applications / 'echo-chamber.desktop').write_text(desktop)
    autostart = home / '.config/autostart'
    autostart.mkdir(parents=True, exist_ok=True)
    (autostart / 'echo-chamber.desktop').write_text(desktop.replace('Exec="' + exec_path + '"', 'Exec="' + exec_path + '" --background'))
    if changed:
        if shell.exists():
            stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
            shutil.copy2(shell, shell.with_suffix('.json.bak.echo-' + stamp))
        shell.parent.mkdir(parents=True, exist_ok=True)
        temporary = shell.with_suffix('.json.echo-tmp')
        temporary.write_text(json.dumps(config, indent=2) + '\n')
        temporary.replace(shell)
    print('Installed Echo Chamber, login autostart, and toolbar plugin.')
    print('Launch: ' + str(launcher))
    print('An existing call is left running. Quit and reopen the app when ready to use this build.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home', type=pathlib.Path, default=pathlib.Path.home(), help='Installation home (for isolated testing)')
    args = parser.parse_args()
    install(pathlib.Path(__file__).resolve().parent.parent, args.home)
