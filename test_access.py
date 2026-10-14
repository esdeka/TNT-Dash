"""Private-key access policy tests. All keys are fictional; no upstream calls.
Run: python -m unittest -v test_access.py
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.request import HTTPRedirectHandler, Request, urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer
import json
import threading
import unittest
import mobility_config as mc
import server

FAKE_KEY = 'test-only-private-value-not-a-real-api-key'


class ConfigurationTests(unittest.TestCase):
    def test_no_key_uses_discovery_manual_only(self):
        for env in [{}, {'BMC_API_KEY':'  ', 'BMC_AUTH_DAILY_LIMIT':'10000'}]:
            c=mc.load_config(env)
            self.assertEqual(c.base,mc.ANONYMOUS_BASE)
            self.assertEqual(c.mode,'anonymous')
            self.assertFalse(c.public()['autoRefreshAllowed'])
            self.assertEqual(c.daily_limit,80)
            self.assertIsNone(c.request('datasets/stibmivb/rt/WaitingTimes').get_header('Ocp-apim-subscription-key'))

    def test_key_uses_registered_gateway_without_exposing_or_redirecting_secret(self):
        c=mc.load_config({'BMC_API_KEY':FAKE_KEY})
        self.assertEqual(c.base,mc.REGISTERED_BASE)
        self.assertEqual(c.daily_limit,10000)
        self.assertTrue(c.public()['autoRefreshAllowed'])
        req=c.request('gtfs/feed/delijn/rt/trip-update')
        self.assertEqual(req.get_header('Ocp-apim-subscription-key'),FAKE_KEY)
        self.assertNotIn(FAKE_KEY,req.full_url)
        self.assertNotIn(FAKE_KEY,repr(c))
        self.assertNotIn(FAKE_KEY,json.dumps(c.public()))
        redirect=HTTPRedirectHandler().redirect_request(req,None,302,'',{},'https://example.org/redirect')
        self.assertIsNone(redirect.get_header('Ocp-apim-subscription-key'))

    def test_secret_file_and_validation(self):
        with TemporaryDirectory() as tmp:
            p=Path(tmp)/'key';p.write_text(FAKE_KEY+'\n')
            c=mc.load_config({'BMC_API_KEY_FILE':str(p),'BMC_AUTH_DAILY_LIMIT':'8000'})
            self.assertEqual(c.api_key,FAKE_KEY)
            self.assertEqual(c.daily_limit,8000)
            self.assertNotIn(str(p),json.dumps(c.public()))
        for env in [{'BMC_API_KEY':FAKE_KEY,'BMC_AUTH_BASE':'http://example.org/api/'},
                    {'BMC_API_KEY':FAKE_KEY,'BMC_AUTH_BASE':'https://user:pass@example.org/api/'},
                    {'BMC_API_KEY':FAKE_KEY,'BMC_AUTH_DAILY_LIMIT':'999999'}]:
            with self.assertRaises(ValueError):mc.load_config(env)


class AccessPolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp=TemporaryDirectory();root=Path(self.temp.name)
        self.patches=[patch.object(server,'STATE_PATH',root/'live.json'),patch.object(server,'QUOTA_PATH',root/'quota.json'),
                      patch.object(server,'STATE',{'providers':{},'lastAttempt':0}),
                      patch.object(server,'QUOTA',server.migrate_quota({'calls':[]}))]
        for p in self.patches:p.start()
        self.provider_patch=patch.object(server,'fetch_provider',side_effect=lambda op:(op,{'ok':True,'fetchedAt':1000,'records':[]}))
        self.fetch=self.provider_patch.start()
        self.patches.append(self.provider_patch)

    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()

    def test_legacy_quota_is_preserved_per_mode(self):
        q=server.migrate_quota({'calls':[1,2,3]})
        self.assertEqual(q['buckets']['anonymous']['calls'],[1,2,3])
        self.assertEqual(q['buckets']['registered']['calls'],[])
        self.assertEqual(server.migrate_quota(q),q)

    def test_anonymous_auto_is_blocked_but_manual_works(self):
        with patch.object(server,'CONFIG',mc.load_config({})):
            data=server.get_live(True,automatic=True)
            self.fetch.assert_not_called()
            self.assertFalse(data['access']['autoRefreshAllowed'])
            self.assertEqual(data['quota']['used'],0)
            data=server.get_live(True,automatic=False)
            self.assertEqual(self.fetch.call_count,2)
            self.assertEqual(data['quota']['used'],2)
            server.get_live(False)
            self.assertEqual(self.fetch.call_count,2)

    def test_registered_auto_and_separate_quota(self):
        with patch.object(server,'CONFIG',mc.load_config({'BMC_API_KEY':FAKE_KEY})):
            data=server.get_live(True,automatic=True)
            self.assertEqual(self.fetch.call_count,2)
            self.assertTrue(data['access']['autoRefreshAllowed'])
            self.assertEqual(data['quota']['limit'],10000)
            self.assertEqual(data['quota']['used'],2)
            self.assertEqual(server.QUOTA['buckets']['anonymous']['calls'],[])
            self.assertNotIn(FAKE_KEY,json.dumps(data))
            self.assertNotIn(FAKE_KEY,server.STATE_PATH.read_text())
            self.assertNotIn(FAKE_KEY,server.QUOTA_PATH.read_text())

    def test_unmarked_http_calls_fail_closed_without_a_key(self):
        http=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
        try:
            with patch.object(server,'CONFIG',mc.load_config({})):
                base=f'http://127.0.0.1:{http.server_port}'
                with urlopen(base+'/api/live') as r:self.assertFalse(json.load(r)['access']['autoRefreshAllowed'])
                with urlopen(Request(base+'/api/live/refresh',method='POST')) as r:self.assertEqual(json.load(r)['quota']['used'],0)
                self.fetch.assert_not_called()
                req=Request(base+'/api/live/refresh',method='POST',headers={'X-Commute-Refresh':'manual'})
                with urlopen(req) as r:self.assertEqual(json.load(r)['quota']['used'],2)
                self.assertEqual(self.fetch.call_count,2)
        finally:
            http.shutdown();http.server_close();thread.join()

    def test_rejected_key_does_not_fall_back_or_leak(self):
        # Use the real fetch function, not the generic fixture above.
        self.provider_patch.stop()
        import io
        body=io.BytesIO(json.dumps({'error':'invalid '+FAKE_KEY}).encode())
        failure=HTTPError(mc.REGISTERED_BASE,401,'Denied',{},body)
        with patch.object(server,'CONFIG',mc.load_config({'BMC_API_KEY':FAKE_KEY})),patch.object(server,'urlopen',side_effect=failure) as request:
            op,data=server.fetch_provider('stib')
            self.assertFalse(data['ok']);self.assertEqual(data['errorKind'],'authentication')
            self.assertEqual(request.call_count,1)
            self.assertTrue(request.call_args.args[0].full_url.startswith(mc.REGISTERED_BASE))
            self.assertNotIn(FAKE_KEY,json.dumps(data))


if __name__=='__main__':unittest.main()
