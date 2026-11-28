from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class PersonnelRoleMigrationTests(TransactionTestCase):
    def test_existing_record_migrates_without_a_role(self):
        previous = [('mining_api', '0006_node_latest_gas_resistance_node_latest_pressure_and_more')]
        target = [('mining_api', '0007_personnel_operational_role')]
        executor = MigrationExecutor(connection)
        self.addCleanup(lambda: MigrationExecutor(connection).migrate(target))
        executor.migrate(previous)
        models = executor.loader.project_state(previous).apps
        organisation = models.get_model('mining_api', 'Organisation').objects.create(name='Migration test', slug='migration-test')
        person = models.get_model('mining_api', 'Personnel').objects.create(organisation=organisation, identifier='0002', display_name='Existing person')
        executor = MigrationExecutor(connection)
        executor.migrate(target)
        migrated = executor.loader.project_state(target).apps.get_model('mining_api', 'Personnel').objects.get(pk=person.pk)
        self.assertEqual(migrated.identifier, '0002')
        self.assertEqual(migrated.display_name, 'Existing person')
        self.assertIsNone(migrated.operational_role)
