import os
from pathlib import Path

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv('SECRET_KEY', '')
DEBUG = os.getenv('DEBUG', '0') == '1'
COMPALLETTE_BUILD_REVISION = os.getenv('COMPALLETTE_BUILD_REVISION', 'development')

if not SECRET_KEY:
    raise RuntimeError('SECRET_KEY must be set')
if len(SECRET_KEY) < 32 or 'replace-with' in SECRET_KEY:
    raise RuntimeError('SECRET_KEY must be a unique random value of at least 32 characters')

ALLOWED_HOSTS = [host.strip() for host in os.getenv('ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') if host.strip()]
CSRF_TRUSTED_ORIGINS = [origin.strip() for origin in os.getenv(
    'CSRF_TRUSTED_ORIGINS', 'http://localhost:3000,http://localhost:5173'
).split(',') if origin.strip()]

# Application definition
INSTALLED_APPS = [
    'daphne',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    # Third party
    'corsheaders',
    'rest_framework',
    'channels',

    # Compallette Mining Core
    'mining_api.apps.MiningApiConfig',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'compallette.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'compallette.wsgi.application'
ASGI_APPLICATION = 'compallette.asgi.application'

# Database Configuration
# Uses PostgreSQL if DB_HOST is provided, falls back to SQLite for local development
if os.getenv('DB_HOST'):
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': os.getenv('DB_NAME', 'compallette_db'),
            'USER': os.getenv('DB_USER', 'compallette_user'),
            'PASSWORD': os.getenv('DB_PASSWORD', 'compallette_secure_pass_2026'),
            'HOST': os.getenv('DB_HOST', 'db'),
            'PORT': os.getenv('DB_PORT', '5432'),
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'compallette_dev.sqlite3',
        }
    }

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Africa/Lusaka'  # Local mining time zone (Zambia)
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Django REST Framework Configuration
REST_FRAMEWORK = {
    'EXCEPTION_HANDLER': 'mining_api.api_contract.api_exception_handler',
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'mining_api.api_contract.OperatorSessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
        'rest_framework.renderers.BrowsableAPIRenderer',
    ],
    'DEFAULT_PARSER_CLASSES': [
        'rest_framework.parsers.JSONParser',
    ],
}

# CORS Configuration
CORS_ALLOW_ALL_ORIGINS = os.getenv('CORS_ALLOW_ALL', '0') == '1'
CORS_ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv('CORS_ALLOWED_ORIGINS', '').split(',') if origin.strip()]
if not DEBUG and ('*' in ALLOWED_HOSTS or CORS_ALLOW_ALL_ORIGINS):
    raise RuntimeError('Wildcard hosts and allow-all CORS are forbidden when DEBUG=0')
CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-requested-with',
    'x-api-key',
    'x-gateway-id',
    'x-packet-priority',
]

# Compallette Mining Safety Thresholds & API Security
# Deprecated legacy setting; no supported ingestion route authenticates with it.
COMPALLETTE_API_KEY = os.getenv('COMPALLETTE_API_KEY', '')

CO_WARN_PPM = float(os.getenv('CO_WARN_PPM', 25.0))
CO_CRIT_PPM = float(os.getenv('CO_CRIT_PPM', 50.0))
STALE_THRESHOLD_SEC = int(os.getenv('COMPALLETTE_STALE_SEC', 20))
OFFLINE_THRESHOLD_SEC = int(os.getenv('COMPALLETTE_OFFLINE_SEC', 45))

# Real-time WebSocket Channel Layers (In-Memory for zero external dependencies)
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer"
    }
}

SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = False
SESSION_COOKIE_SECURE = os.getenv('USE_HTTPS', '0') == '1'
CSRF_COOKIE_SECURE = os.getenv('USE_HTTPS', '0') == '1'
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'

# Set once per fresh installation; an unset identity blocks device ingestion.
COMPALLETTE_INSTALLATION_ID = os.getenv('COMPALLETTE_INSTALLATION_ID', '')
COMPALLETTE_DEVICE_KEY_DIR = os.getenv('COMPALLETTE_DEVICE_KEY_DIR', '')
