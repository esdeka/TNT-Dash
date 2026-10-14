"""Server-only Belgian Mobility access configuration.

Anonymous: Discovery gateway, manual live refresh only.
Registered: authenticated gateway + private subscription key; auto refresh allowed.
No key, key fragment, secret-file path or secret value is returned to the browser.
"""
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request
import os

ANONYMOUS_BASE = 'https://api-management-discovery-production.azure-api.net/api/'
REGISTERED_BASE = 'https://api-management-opendata-production.azure-api.net/api/'


@dataclass(frozen=True)
class MobilityConfig:
    base: str
    api_key: str = field(default='', repr=False)
    daily_limit: int = 80
    minute_limit: int = 4

    @property
    def mode(self):
        return 'registered' if self.api_key else 'anonymous'

    def public(self):
        return {'mode': self.mode, 'keyConfigured': bool(self.api_key),
                'autoRefreshAllowed': bool(self.api_key),
                'dailyLimit': self.daily_limit, 'minuteLimit': self.minute_limit}

    def request(self, endpoint, accept='application/json'):
        """Keep the key out of URLs and do not forward it on HTTP redirects."""
        request = Request(self.base + endpoint.lstrip('/'), headers={
            'Accept': accept, 'User-Agent': 'PersonalCommuteDashboard/1.3'})
        if self.api_key:
            request.add_unredirected_header('Ocp-Apim-Subscription-Key', self.api_key)
        return request


def load_config(environ=None):
    env = os.environ if environ is None else environ
    key = str(env.get('BMC_API_KEY') or '').strip()
    if not key and env.get('BMC_API_KEY_FILE'):
        try:
            key = Path(env['BMC_API_KEY_FILE']).read_text().strip()
        except OSError:
            raise ValueError('Cannot read the configured BMC API-key secret file') from None
    if not key:
        return MobilityConfig(ANONYMOUS_BASE)
    base = str(env.get('BMC_AUTH_BASE') or REGISTERED_BASE).rstrip('/') + '/'
    parsed = urlsplit(base)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('BMC_AUTH_BASE must be an HTTPS API base without credentials, query or fragment')
    try:
        daily = int(env.get('BMC_AUTH_DAILY_LIMIT') or '10000')
    except ValueError:
        raise ValueError('BMC_AUTH_DAILY_LIMIT must be an integer') from None
    if not 2 <= daily <= 12000:
        raise ValueError('BMC_AUTH_DAILY_LIMIT must be between 2 and 12000; use your assigned quota')
    return MobilityConfig(base, key, daily, 4)
