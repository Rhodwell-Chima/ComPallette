import json
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import connections
from django.db.migrations.executor import MigrationExecutor
from mining_api.installation import installation_id, InstallationNotConfigured
from mining_api.models import SiteMembership


UNVERSIONED_BUILD_VALUES = {'', 'development', 'unknown', 'replace-with-source-revision'}


class Command(BaseCommand):
    help = 'Verifies database migration, operator bootstrap, and build-identity readiness.'

    def handle(self, *args, **options):
        connection = connections['default']
        connection.ensure_connection()
        executor = MigrationExecutor(connection)
        pending_migrations = executor.migration_plan(executor.loader.graph.leaf_nodes())
        staff_count = get_user_model().objects.filter(is_active=True, is_staff=True).count()
        administrator_exists = get_user_model().objects.filter(is_active=True, is_superuser=True).exists() or SiteMembership.objects.filter(
            user__is_active=True, active=True, organisation__active=True, role='ORG_ADMIN', site__isnull=True).exists()
        build_revision = settings.COMPALLETTE_BUILD_REVISION

        failures = []
        try:
            configured_installation = installation_id()
        except InstallationNotConfigured:
            configured_installation = None
            failures.append('a valid COMPALLETTE_INSTALLATION_ID is required')
        key_directory = settings.COMPALLETTE_DEVICE_KEY_DIR
        keys_available = bool(key_directory and Path(key_directory).is_dir())
        if not keys_available:
            failures.append('COMPALLETTE_DEVICE_KEY_DIR must point to mounted protected enrollment storage')
        if pending_migrations:
            failures.append(f'{len(pending_migrations)} migration(s) are pending')
        if not administrator_exists:
            failures.append('no active superuser or explicit organisation administrator exists')
        if not settings.DEBUG and build_revision in UNVERSIONED_BUILD_VALUES:
            failures.append('COMPALLETTE_BUILD_REVISION must be an immutable deployment revision when DEBUG=0')

        report = {
            'database_connected': True,
            'pending_migrations': len(pending_migrations),
            'active_staff_operators': staff_count,
            'explicit_administrator_available': administrator_exists,
            'build_revision': build_revision,
            'installation_id': configured_installation,
            'device_key_storage_available': keys_available,
            'ready': not failures,
        }
        self.stdout.write(json.dumps(report, sort_keys=True))
        if failures:
            raise CommandError('; '.join(failures))
