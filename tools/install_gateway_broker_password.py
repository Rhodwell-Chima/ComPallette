"""Install/remove one local Mosquitto identity without exposing secrets in argv.

Run while broker configuration changes are serialized in a maintenance window.
Restart the broker afterward to disconnect old sessions and reload bind mounts.
"""
import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile


def update_password_file(password_file, username, credential=None, executable='mosquitto_passwd'):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,23}', username) or username == 'compallette-ingestion':
        raise ValueError('A registered gateway node ID is required.')
    path = Path(password_file).absolute()
    if path.is_symlink():
        raise ValueError('Password storage must be a regular local file, not a symlink.')
    lock_path = path.with_name(path.name + '.lock')
    descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    temporary = None
    try:
        os.close(descriptor)
        existing_metadata = path.stat() if path.exists() else None
        lines = path.read_text(encoding='utf-8').splitlines() if path.exists() else []
        if any(':' not in line or not line.split(':', 1)[1].startswith('$') for line in lines if line):
            raise ValueError('Existing password file contains an invalid/unhashed entry.')
        retained = [line for line in lines if line and line.split(':', 1)[0] != username]
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            os.chmod(temporary, 0o600)
            if credential is not None:
                if not re.fullmatch(r'[A-Za-z0-9_-]{32,63}', credential):
                    raise ValueError('Invalid prepared gateway credential.')
                output.write(f'{username}:{credential}\n')
        if credential is not None:
            # -U is ONLY used on this fresh one-entry plaintext file. Applying it
            # to an existing hashed password file would corrupt its credentials.
            subprocess.run([executable, '-U', str(temporary)], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            hashed = temporary.read_text(encoding='utf-8').strip()
            if not hashed.startswith(username + ':$') or '\n' in hashed:
                raise ValueError('Mosquitto did not produce a valid password entry.')
            retained.append(hashed)
        with temporary.open('w', encoding='utf-8') as output:
            output.write('\n'.join(retained) + '\n')
            output.flush()
            os.fsync(output.fileno())
        if existing_metadata is not None and os.name != 'nt':
            # Atomic replacement must not make a broker-owned file unreadable
            # by changing its owner/group to the provisioning shell's account.
            os.chown(temporary, existing_metadata.st_uid, existing_metadata.st_gid)
            os.chmod(temporary, stat.S_IMODE(existing_metadata.st_mode))
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
        lock_path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--bundle', type=Path)
    source.add_argument('--revoke', metavar='GATEWAY_NODE_ID')
    parser.add_argument('--password-file', type=Path, required=True)
    parser.add_argument('--mosquitto-passwd', default='mosquitto_passwd')
    options = parser.parse_args()
    try:
        if options.bundle:
            bundle = json.loads(options.bundle.read_text(encoding='utf-8'))
            update_password_file(options.password_file, bundle['node_id'], bundle['credential'], options.mosquitto_passwd)
        else:
            update_password_file(options.password_file, options.revoke)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        parser.exit(1, 'Credential installation failed. Check the protected files and mosquitto_passwd installation.\n')
    print('Password file updated. Restart the broker to reload it and disconnect old sessions; then verify activation/ACLs.')


if __name__ == '__main__':
    main()
