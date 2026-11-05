import os
import time

from django.core.management.base import BaseCommand

from mining_api.views import check_and_update_watchdog


class Command(BaseCommand):
    help = 'Continuously evaluates stale and offline node status.'

    def handle(self, *args, **options):
        interval = max(1, int(os.getenv('COMPALLETTE_WATCHDOG_INTERVAL', '5')))
        self.stdout.write(self.style.SUCCESS(f'Watchdog loop started (interval={interval}s)'))
        while True:
            check_and_update_watchdog()
            time.sleep(interval)
