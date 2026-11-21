import uuid
from django.conf import settings
from rest_framework.exceptions import APIException, PermissionDenied


class InstallationNotConfigured(APIException):
    status_code = 503
    default_detail = 'Configure an installation UUID before enabling device traffic.'
    default_code = 'INSTALLATION_NOT_CONFIGURED'


def installation_id():
    try:
        return str(uuid.UUID(settings.COMPALLETTE_INSTALLATION_ID))
    except (ValueError, TypeError, AttributeError):
        raise InstallationNotConfigured()


def verify_installation(data):
    expected = installation_id()
    if data.get('installation_id') != expected:
        raise PermissionDenied({'error': 'Traffic belongs to a different or unspecified installation.',
                                'error_code': 'INSTALLATION_MISMATCH'})
    return expected
