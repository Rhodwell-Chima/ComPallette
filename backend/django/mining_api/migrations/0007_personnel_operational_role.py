from django.db import migrations, models


def limit_ddl_lock_wait(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute("SET LOCAL lock_timeout = '2s'")


class Migration(migrations.Migration):
    dependencies = [('mining_api', '0006_node_latest_gas_resistance_node_latest_pressure_and_more')]

    operations = [
        migrations.RunPython(limit_ddl_lock_wait, migrations.RunPython.noop),
        migrations.AddField(
            model_name='personnel',
            name='operational_role',
            field=models.CharField(
                blank=True,
                null=True,
                max_length=32,
                choices=[
                    ('UNDERGROUND_MINER', 'Underground miner'),
                    ('SHIFT_SUPERVISOR', 'Shift supervisor'),
                    ('MAINTENANCE_TECHNICIAN', 'Maintenance technician'),
                    ('EQUIPMENT_OPERATOR', 'Equipment operator'),
                    ('SAFETY_OFFICER', 'Safety officer'),
                ],
            ),
        ),
    ]
