from django.core.management.base import BaseCommand, CommandError
from django.core.management import call_command
from django.db import transaction
from mining_api.models import Organisation, Site, Node, Personnel, Asset, SafetyAlert, TelemetryRecord, Zone


class Command(BaseCommand):
    help = 'Bootstrap an empty Pilot Site in a fresh database; never reset an existing installation.'

    def handle(self, *args, **options):
        if any(model.objects.exists() for model in [Node, Personnel, Asset, SafetyAlert, TelemetryRecord, Zone]):
            raise CommandError('Database contains operational data. Create a separate fresh database; nothing was changed.')
        with transaction.atomic():
            org, _ = Organisation.objects.get_or_create(slug='compallette-operations', defaults={'name': 'ComPallette Operations'})
            site = Site.objects.filter(organisation=org, code='MINING-PILOT').first()
            if site:
                site.code = 'PILOT'; site.name = 'Pilot Site'; site.industry = 'GENERAL'; site.save()
            else:
                Site.objects.get_or_create(organisation=org, code='PILOT', defaults={'name': 'Pilot Site', 'industry': 'GENERAL'})
        self.stdout.write('Empty Pilot Site ready. Create its administrator securely:')
        call_command('createsuperuser')
