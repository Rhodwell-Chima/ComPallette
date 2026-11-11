# Generated for the industrial intelligence platform domain.

from django.conf import settings
import django.db.models.deletion
from django.db import migrations, models


def create_default_platform(apps, schema_editor):
    Organisation = apps.get_model('mining_api', 'Organisation')
    Site = apps.get_model('mining_api', 'Site')
    Zone = apps.get_model('mining_api', 'Zone')
    Node = apps.get_model('mining_api', 'Node')
    AuditEntry = apps.get_model('mining_api', 'AuditEntry')

    organisation, _ = Organisation.objects.get_or_create(
        slug='compallette-operations',
        defaults={'name': 'ComPallette Operations'},
    )
    site, _ = Site.objects.get_or_create(
        organisation=organisation,
        code='MINING-PILOT',
        defaults={'name': 'Mining Pilot Site', 'industry': 'MINING'},
    )
    FacilityLayout = apps.get_model('mining_api', 'FacilityLayout')
    FacilityLayout.objects.get_or_create(site=site, defaults={'geometry': {'version': 1, 'features': []}})

    for zone_code in Node.objects.exclude(current_zone__in=['', 'UNASSIGNED']).values_list('current_zone', flat=True).distinct():
        Zone.objects.get_or_create(
            site=site,
            code=zone_code,
            defaults={'name': zone_code.replace('-', ' ').title()},
        )

    zones = {zone.code: zone for zone in Zone.objects.filter(site=site)}
    for node in Node.objects.all():
        node.organisation = organisation
        node.site = site
        node.zone_ref = zones.get(node.current_zone)
        node.location_evidence = 'CONFIRMED' if node.zone_ref and node.last_seen_ts else 'UNKNOWN'
        node.location_observed_at = node.last_seen_ts
        node.save(update_fields=['organisation', 'site', 'zone_ref', 'location_evidence', 'location_observed_at'])
    AuditEntry.objects.filter(site__isnull=True).update(site=site)


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('mining_api', '0002_provisioningrequest'),
    ]

    operations = [
        migrations.CreateModel(
            name='Organisation',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=120, unique=True)),
                ('slug', models.SlugField(max_length=140, unique=True)),
                ('active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={'ordering': ['name']},
        ),
        migrations.CreateModel(
            name='Site',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=120)),
                ('code', models.CharField(max_length=32)),
                ('industry', models.CharField(default='MINING', max_length=40)),
                ('timezone', models.CharField(default='Africa/Lusaka', max_length=64)),
                ('active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('organisation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='sites', to='mining_api.organisation')),
            ],
            options={'ordering': ['name']},
        ),
        migrations.AddConstraint(
            model_name='site',
            constraint=models.UniqueConstraint(fields=('organisation', 'code'), name='unique_site_code_per_org'),
        ),
        migrations.CreateModel(
            name='Structure',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=120)),
                ('structure_type', models.CharField(default='FACILITY', max_length=40)),
                ('description', models.TextField(blank=True, default='')),
                ('site', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='structures', to='mining_api.site')),
            ],
            options={'ordering': ['name']},
        ),
        migrations.AddConstraint(
            model_name='structure',
            constraint=models.UniqueConstraint(fields=('site', 'name'), name='unique_structure_name_per_site'),
        ),
        migrations.CreateModel(
            name='Level',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=120)),
                ('sort_order', models.IntegerField(default=0)),
                ('description', models.TextField(blank=True, default='')),
                ('structure', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='levels', to='mining_api.structure')),
            ],
            options={'ordering': ['sort_order', 'name']},
        ),
        migrations.AddConstraint(
            model_name='level',
            constraint=models.UniqueConstraint(fields=('structure', 'name'), name='unique_level_name_per_structure'),
        ),
        migrations.CreateModel(
            name='Zone',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(max_length=64)),
                ('name', models.CharField(max_length=120)),
                ('zone_type', models.CharField(default='OPERATIONAL', max_length=40)),
                ('description', models.TextField(blank=True, default='')),
                ('is_restricted', models.BooleanField(default=False)),
                ('is_hazardous', models.BooleanField(default=False)),
                ('geometry', models.JSONField(blank=True, default=dict)),
                ('active', models.BooleanField(default=True)),
                ('level', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='zones', to='mining_api.level')),
                ('site', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='zones', to='mining_api.site')),
            ],
            options={'ordering': ['code']},
        ),
        migrations.AddConstraint(
            model_name='zone',
            constraint=models.UniqueConstraint(fields=('site', 'code'), name='unique_zone_code_per_site'),
        ),
        migrations.CreateModel(
            name='FacilityLayout',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('version', models.PositiveIntegerField(default=1)),
                ('geometry', models.JSONField(blank=True, default=dict)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('site', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='layout', to='mining_api.site')),
            ],
        ),
        migrations.AddField(
            model_name='node', name='organisation',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='nodes', to='mining_api.organisation'),
        ),
        migrations.AddField(
            model_name='node', name='site',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='nodes', to='mining_api.site'),
        ),
        migrations.AddField(
            model_name='node', name='zone_ref',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='nodes', to='mining_api.zone'),
        ),
        migrations.AddField(model_name='node', name='location_evidence', field=models.CharField(choices=[('CONFIRMED', 'Confirmed direct evidence'), ('ESTIMATED', 'Estimated zone'), ('LAST_KNOWN', 'Stale last-known zone'), ('UNKNOWN', 'Unknown or unassigned')], default='UNKNOWN', max_length=16)),
        migrations.AddField(model_name='node', name='location_observed_at', field=models.BigIntegerField(default=0)),
        migrations.CreateModel(
            name='Personnel',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('identifier', models.CharField(max_length=32, unique=True)),
                ('display_name', models.CharField(max_length=120)),
                ('team', models.CharField(blank=True, default='', max_length=80)),
                ('employment_status', models.CharField(default='ACTIVE', max_length=24)),
                ('assigned_node', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='assigned_person', to='mining_api.node')),
                ('organisation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='personnel', to='mining_api.organisation')),
                ('site', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='personnel', to='mining_api.site')),
            ],
            options={'ordering': ['display_name', 'identifier']},
        ),
        migrations.CreateModel(
            name='Asset',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('identifier', models.CharField(max_length=32, unique=True)),
                ('name', models.CharField(max_length=120)),
                ('asset_type', models.CharField(blank=True, default='', max_length=80)),
                ('operational_status', models.CharField(default='ACTIVE', max_length=24)),
                ('assigned_node', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='assigned_asset', to='mining_api.node')),
                ('organisation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='assets', to='mining_api.organisation')),
                ('site', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='assets', to='mining_api.site')),
            ],
            options={'ordering': ['name', 'identifier']},
        ),
        migrations.CreateModel(
            name='SiteMembership',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('role', models.CharField(choices=[('ORG_ADMIN', 'Organisation Administrator'), ('SITE_ADMIN', 'Site Administrator'), ('OPERATIONS', 'Operations Controller'), ('SAFETY', 'Safety Officer'), ('TECHNICIAN', 'Technician'), ('VIEWER', 'Read-only Viewer')], default='VIEWER', max_length=24)),
                ('active', models.BooleanField(default=True)),
                ('organisation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='memberships', to='mining_api.organisation')),
                ('site', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='memberships', to='mining_api.site')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='compallette_memberships', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddConstraint(model_name='sitemembership', constraint=models.UniqueConstraint(fields=('user', 'organisation', 'site'), name='unique_user_organisation_site_membership')),
        migrations.CreateModel(
            name='DeviceCapability',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('measurement_key', models.CharField(max_length=48)),
                ('display_name', models.CharField(max_length=80)),
                ('unit', models.CharField(max_length=24)),
                ('warning_threshold', models.FloatField(blank=True, null=True)),
                ('critical_threshold', models.FloatField(blank=True, null=True)),
                ('active', models.BooleanField(default=True)),
                ('node', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='capabilities', to='mining_api.node')),
            ],
        ),
        migrations.AddConstraint(model_name='devicecapability', constraint=models.UniqueConstraint(fields=('node', 'measurement_key'), name='unique_node_measurement_capability')),
        migrations.CreateModel(
            name='MeasurementReading',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('measurement_key', models.CharField(max_length=48)),
                ('value', models.FloatField()),
                ('unit', models.CharField(max_length=24)),
                ('source_seq', models.PositiveIntegerField(default=0)),
                ('received_at', models.BigIntegerField()),
                ('zone', models.CharField(blank=True, default='', max_length=64)),
                ('capability', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='readings', to='mining_api.devicecapability')),
                ('node', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='measurements', to='mining_api.node')),
            ],
            options={'ordering': ['-received_at']},
        ),
        migrations.AddConstraint(model_name='measurementreading', constraint=models.UniqueConstraint(fields=('node', 'measurement_key', 'source_seq'), name='unique_measurement_source_event')),
        migrations.AddIndex(model_name='measurementreading', index=models.Index(fields=['measurement_key', '-received_at'], name='mining_api__measure_64402f_idx')),
        migrations.AddField(model_name='safetyalert', name='assigned_at', field=models.BigIntegerField(blank=True, null=True)),
        migrations.AddField(model_name='safetyalert', name='investigation_notes', field=models.TextField(blank=True, default='')),
        migrations.AddField(model_name='safetyalert', name='assigned_to', field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='assigned_safety_alerts', to=settings.AUTH_USER_MODEL)),
        migrations.AlterField(
            model_name='safetyalert',
            name='status',
            field=models.CharField(choices=[('NEW', 'Unacknowledged Alarm'), ('ACKNOWLEDGED', 'Under Investigation'), ('INVESTIGATING', 'Assigned for Investigation'), ('RESOLVED', 'Cleared & Closed')], default='NEW', max_length=16),
        ),
        migrations.AddField(model_name='auditentry', name='site', field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='audit_entries', to='mining_api.site')),
        migrations.RunPython(create_default_platform, migrations.RunPython.noop),
    ]
