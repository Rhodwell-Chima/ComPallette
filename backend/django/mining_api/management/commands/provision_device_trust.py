"""Create local enrollment keys without returning secrets through the API."""
import json
import os
import re
import secrets
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from mining_api.installation import installation_id
from mining_api.models import Site


def create_private_file(path, payload):
    # Exclusive creation prevents accidental replacement and follows no symlink.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
        json.dump(payload, stream, sort_keys=True)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


class Command(BaseCommand):
    help = 'Creates a per-device key and a protected LittleFS enrollment bundle. Never prints keys.'

    def add_arguments(self, parser):
        parser.add_argument('--hardware-id', required=True)
        parser.add_argument('--site', required=True, type=int)
        parser.add_argument('--output-directory', required=True)
        parser.add_argument('--ntp-host', default='')

    def handle(self, *args, **options):
        hardware = options['hardware_id']
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,32}', hardware):
            raise CommandError('Invalid hardware identity.')
        if not Site.objects.filter(pk=options['site'], active=True, organisation__active=True).exists():
            raise CommandError('An active site and organisation are required.')
        if not settings.COMPALLETTE_DEVICE_KEY_DIR:
            raise CommandError('Set COMPALLETTE_DEVICE_KEY_DIR to protected local storage.')
        root = Path(settings.COMPALLETTE_DEVICE_KEY_DIR).resolve()
        output = Path(options['output_directory']).resolve()
        if not root.is_dir() or not output.is_dir():
            raise CommandError('Create protected key and output directories before provisioning.')
        server_file, device_file = root / f'{hardware}.json', output / 'device-trust.json'
        if server_file.exists() or device_file.exists():
            raise CommandError('Enrollment material already exists. Refusing to replace an active key.')
        payload = {'hardware_id': hardware, 'site_id': options['site'],
                   'installation_id': installation_id(), 'key': secrets.token_hex(32)}
        if options['ntp_host']:
            if not re.fullmatch(r'[A-Za-z0-9.:-]{1,253}', options['ntp_host']):
                raise CommandError('Invalid local time host.')
            payload['ntp_host'] = options['ntp_host']
        try:
            create_private_file(server_file, payload)
            try:
                create_private_file(device_file, payload)
            except OSError:
                server_file.unlink()
                raise
        except OSError as error:
            raise CommandError('Could not create enrollment files; check protected storage permissions.') from error
        self.stdout.write('Enrollment files created. Install device-trust.json through the local maintenance workflow.')
