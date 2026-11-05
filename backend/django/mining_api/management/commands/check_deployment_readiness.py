import json

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import connections
from django.db.migrations.executor import MigrationExecutor


UNVERSIONED_BUILD_VALUES = {'', 'development', 'unknown', 'replace-with-source-revision'}


class Command(BaseCommand):
    help = 'Verifies database migration, operator bootstrap, and build-identity readiness.'

    def handle(self, *args, **options):
        connection = connections['default']
        connection.ensure_connection()
        executor = MigrationExecutor(connection)
        pending_migrations = executor.migration_plan(executor.loader.graph.leaf_nodes())
        staff_count = get_user_model().objects.filter(is_active=True, is_staff=True).count()
        build_revision = settings.COMPALLETTE_BUILD_REVISION

        failures = []
        if pending_migrations:
            failures.append(f'{len(pending_migrations)} migration(s) are pending')
        if staff_count == 0:
            failures.append('no active Django staff operator exists')
        if not settings.DEBUG and build_revision in UNVERSIONED_BUILD_VALUES:
            failures.append('COMPALLETTE_BUILD_REVISION must be an immutable deployment revision when DEBUG=0')

        report = {
            'database_connected': True,
            'pending_migrations': len(pending_migrations),
            'active_staff_operators': staff_count,
            'build_revision': build_revision,
            'ready': not failures,
        }
        self.stdout.write(json.dumps(report, sort_keys=True))
        if failures:
            raise CommandError('; '.join(failures))
