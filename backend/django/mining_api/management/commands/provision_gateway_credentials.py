"""Local, two-phase credential installation. No secrets travel through the UI."""
import json
import secrets
import threading
import uuid
from pathlib import Path

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password, check_password
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from mining_api.access import enforce
from mining_api.device_trust import device_key
from mining_api.installation import installation_id
from mining_api.models import GatewayRegistration
from mining_api.operations import audit
from .provision_device_trust import create_private_file


def verify_broker(host, port, ca, username, credential):
    import paho.mqtt.client as mqtt
    completed = threading.Event()
    accepted = []
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f'credential-check-{uuid.uuid4()}')
    client.username_pw_set(username, credential)
    client.tls_set(ca_certs=ca)

    def connected(client, userdata, flags, reason, properties):
        accepted.append(not reason.is_failure)
        completed.set()

    client.on_connect = connected
    try:
        client.connect(host, port, 15)
        client.loop_start()
        if not completed.wait(15) or accepted != [True]:
            raise CommandError('Broker did not accept the prepared credential over verified TLS.')
    except OSError as error:
        raise CommandError('Could not verify broker TLS and credentials.') from error
    finally:
        client.disconnect()
        client.loop_stop()


class Command(BaseCommand):
    help = 'Prepare a protected gateway bundle, then activate only after verifying broker TLS authentication.'

    def add_arguments(self, parser):
        parser.add_argument('action', choices=['prepare', 'activate'])
        parser.add_argument('--gateway', required=True, type=int)
        parser.add_argument('--actor', required=True)
        parser.add_argument('--directory', required=True)
        parser.add_argument('--broker-host')
        parser.add_argument('--broker-port', type=int, default=8883)
        parser.add_argument('--ca-file')

    @transaction.atomic
    def handle(self, *args, **options):
        gateway = GatewayRegistration.objects.select_for_update().select_related('node', 'site__organisation').get(pk=options['gateway'])
        actor = get_user_model().objects.get(username=options['actor'], is_active=True)
        if not gateway.active or not gateway.site.active or not gateway.site.organisation.active:
            raise CommandError('Gateway, site and organisation must be active.')
        enforce(actor, 'manage_devices', gateway.site)
        device_key(gateway.node.hardware_id, gateway.site_id)
        directory = Path(options['directory']).resolve()
        if not directory.is_dir():
            raise CommandError('Create a protected output directory first.')
        filename = directory / 'gateway-credentials.json'
        if options['action'] == 'prepare':
            if filename.exists() or gateway.credentials_installed:
                raise CommandError('Rotate the registration and use a new protected directory before replacing credentials.')
            credential = secrets.token_urlsafe(32)
            bundle = {'installation_id': installation_id(), 'site_id': gateway.site_id,
                      'hardware_id': gateway.node.hardware_id, 'node_id': gateway.node_id,
                      'credential_version': gateway.credential_version, 'credential': credential}
            try:
                create_private_file(filename, bundle)
            except OSError as error:
                raise CommandError('Cannot write the protected gateway bundle.') from error
            gateway.credential_hash = make_password(credential)
            gateway.credentials_installed = False
            gateway.save(update_fields=['credential_hash', 'credentials_installed'])
            audit(actor, gateway.site, 'GATEWAY_CREDENTIAL_PREPARED', gateway.node, {'version': gateway.credential_version})
            self.stdout.write('Bundle prepared. Install the broker password, restricted ACL, CA and device bundle locally; then activate.')
            return
        if not options['broker_host'] or not options['ca_file']:
            raise CommandError('Activation requires --broker-host and --ca-file.')
        try:
            bundle = json.loads(filename.read_text(encoding='utf-8'))
            expected = {'installation_id': installation_id(), 'site_id': gateway.site_id,
                        'hardware_id': gateway.node.hardware_id, 'node_id': gateway.node_id,
                        'credential_version': gateway.credential_version}
            if any(bundle.get(key) != value for key, value in expected.items()) or not check_password(bundle.get('credential', ''), gateway.credential_hash):
                raise ValueError('Bundle does not match registration')
        except (OSError, ValueError, TypeError) as error:
            raise CommandError('A matching prepared gateway bundle is required.') from error
        verify_broker(options['broker_host'], options['broker_port'], options['ca_file'], gateway.node_id, bundle['credential'])
        gateway.credentials_installed = True
        gateway.save(update_fields=['credentials_installed'])
        gateway.node.commissioned = True
        gateway.node.save(update_fields=['commissioned'])
        audit(actor, gateway.site, 'GATEWAY_CREDENTIAL_ACTIVATED', gateway.node, {'version': gateway.credential_version})
        self.stdout.write('Broker authentication verified; application gateway access activated. Hardware delivery and ACL tests remain separate release gates.')
