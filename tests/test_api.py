"""Offline backend/API regression tests. No provider requests or quota resets.
Run: python -m unittest -v test_api.py
"""
import copy
import json
import threading
import unittest
from urllib.request import urlopen
from urllib.error import HTTPError
from unittest.mock import patch, MagicMock
from http.server import ThreadingHTTPServer
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'server'))
import rail
import server



class RailTests(unittest.TestCase):
    def setUp(self):
        rail.CACHE.clear()
        rail.CALLS.clear()
        self.body = {'timestamp':'1788609600','station':'Brussels-North',
            'stationinfo':{'id':rail.STATION_ID,'name':'Brussels-North'},
            'departures':{'departure':[{'time':'1788762600','delay':'1200',
                'vehicle':'BE.NMBS.TEST1','vehicleinfo':{'shortname':'TEST 1'},
                'station':'Fixture destination','platform':'4','platforminfo':{'normal':'0'},
                'canceled':'1','left':'0','departureConnection':'fixture-train-1'}]}}

    def test_normalize_keeps_scheduled_time_and_flags(self):
        d = rail.normalize_board(self.body,'2026-09-07','08:00',1788609600)
        r = d['departures'][0]
        self.assertEqual(r['scheduledDeparture'],1788762600)
        self.assertEqual(r['expectedDeparture'],1788763800)
        self.assertTrue(r['cancelled'])
        self.assertFalse(r['left'])
        self.assertTrue(r['platformChanged'])

    def test_wrong_station_is_rejected(self):
        bad = copy.deepcopy(self.body)
        bad['stationinfo']['id'] = 'BE.NMBS.008814001'
        with self.assertRaises(ValueError):
            rail.normalize_board(bad,'2026-09-07','08:00',1788609600)

    def test_cache_and_fixed_station_query(self):
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = json.dumps(self.body).encode()
        response.headers = {'Cache-Control':'private, max-age=120'}
        with patch.object(rail, 'urlopen', return_value=response) as request, patch.object(rail.time,'time',return_value=1788609600):
            a, status = rail.get_board('2026-09-07','08:00')
            b, status2 = rail.get_board('2026-09-07','08:00')
            self.assertEqual((status,status2),(200,200))
            self.assertFalse(a['cached'])
            self.assertTrue(b['cached'])
            self.assertEqual(request.call_count,1)
            self.assertIn('id=BE.NMBS.008812005',request.call_args.args[0].full_url)
            self.assertEqual(a['fetchedAt'],b['fetchedAt'])

    def test_upstream_failure_has_no_example_trains(self):
        with patch.object(rail, 'urlopen', side_effect=HTTPError(rail.ENDPOINT,500,'Failure',{},None)):
            data, status = rail.get_board('2026-09-07','08:00')
        self.assertEqual(status,502)
        self.assertFalse(data['ok'])
        self.assertEqual(data['departures'],[])

    def test_local_rate_limiter(self):
        rail.CALLS.extend(range(1940,1960))
        with patch.object(rail.time,'time',return_value=1990), patch.object(rail,'urlopen') as request:
            data,status = rail.get_board('2026-09-07','08:00')
        self.assertEqual(status,429)
        request.assert_not_called()


class HttpContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        cls.worker = threading.Thread(target=cls.http.serve_forever,daemon=True)
        cls.worker.start()
        cls.base = f'http://127.0.0.1:{cls.http.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.worker.join()

    def test_served_page_and_health(self):
        with urlopen(self.base+'/api/health') as r:
            body=json.load(r)
            self.assertEqual(body['app'],'Commute dashboard')
        with urlopen(self.base+'/') as r:
            html=r.read().decode()
            self.assertIn('window.COMMUTE_SERVER = true;',html)
            self.assertLess(html.index('id="recommendation"'),html.index('id="planner"'))
            self.assertNotIn('Your daily connection.',html)

    def test_invalid_input_http_400(self):
        with self.assertRaises(HTTPError) as got:
            urlopen(self.base+'/api/trains?date=banana')
        self.assertEqual(got.exception.code,400)

    def test_docs_whitelist_and_no_arbitrary_file_serving(self):
        with urlopen(self.base+'/docs/AGENTS.md') as r:
            self.assertIn('Agent handoff',r.read().decode())
        for private in ('/data/quota.json', '/Dashboard-secrets.js', '/../server/state/quota.json', '/%2e%2e/data/timetable.json'):
            with self.assertRaises(HTTPError) as got:
                urlopen(self.base+private)
            self.assertEqual(got.exception.code,404, private)


if __name__ == '__main__':
    unittest.main()
