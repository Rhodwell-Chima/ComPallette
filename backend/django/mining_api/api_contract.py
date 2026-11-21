"""Shared operator authentication and machine-readable API failure contracts."""
from rest_framework.authentication import SessionAuthentication

CONTRACT_VERSION = 2


class OperatorSessionAuthentication(SessionAuthentication):
    def authenticate_header(self, request):
        # DRF otherwise converts an absent session into 403, indistinguishable
        # from an authenticated operator who lacks the requested permission.
        return 'Session'


def api_exception_handler(exc, context):
    from rest_framework.views import exception_handler
    response = exception_handler(exc, context)
    if response is None:
        return None
    codes = {400: 'VALIDATION_ERROR', 401: 'AUTHENTICATION_REQUIRED',
             403: 'FORBIDDEN', 404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED',
             409: 'CONFLICT', 410: 'RETIRED_OPERATION', 429: 'RATE_LIMITED'}
    data = response.data
    if not isinstance(data, dict):
        data = {'details': data}
    message = data.get('error', data.get('detail'))
    if not isinstance(message, str):
        message = 'Request validation failed.' if response.status_code == 400 else str(exc)
    explicit_code = getattr(exc, 'default_code', '')
    fallback = explicit_code if isinstance(explicit_code, str) and explicit_code.isupper() else codes.get(response.status_code, 'SERVER_ERROR')
    response.data = {**data, 'error': message, 'error_code': data.get('error_code', fallback)}
    return response
