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
import rail
import server


class PlannerApiTests(unittest.TestCase):
    def calculate(self, query, train=False):
        with patch.object(server.time, 'time', return_value=1788609600), patch.object(server, 'get_live', return_value={'providers': {}}) as cached, \
             patch.object(server, 'fetch_provider', side_effect=AssertionError('Must not fetch live')):
            result, status = server.engine_response(query, train=train)
            cached.assert_called_once_with(False)
        self.assertEqual(status, 200, result)
        self.assertEqual(result['upstream_requests_made'], 0)
        return result

    def test_next_uses_same_walk_and_arrival_logic(self):
        result = self.calculate({'date':'2026-09-07','time':'08:00'})
        r = result['recommendation']
        self.assertEqual(r['line'], '14')
        self.assertEqual(r['leave_home_at'], '2026-09-07T06:01:00.000Z')
        self.assertEqual(r['arrival'], '2026-09-07T06:12:00.000Z')
        self.assertEqual(r['walk_minutes'], 5)
        self.assertEqual(r['total_minutes'], 12)
        self.assertEqual(set(result['next_by_operator']), {'shuttle','stib','delijn'})

    def test_return_walk_is_included(self):
        result = self.calculate({'date':'2026-09-07','time':'08:00','direction':'toTNT'})
        self.assertTrue(result['walking_included'])
        self.assertEqual(result['recommendation']['walk_after_minutes'], 8)
        self.assertIsNotNone(result['recommendation']['home_arrival'])
        self.assertIsNone(result['recommendation']['leave_home_at'])

    def test_shuttle_weekend_is_null_not_fabricated(self):
        result = self.calculate({'date':'2026-09-05','time':'08:00','horizon':'120'})
        self.assertIsNone(result['next_by_operator']['shuttle'])
        self.assertIsNotNone(result['next_by_operator']['stib'])

    def test_train_default_five_minute_margin(self):
        result = self.calculate({'date':'2026-09-07','time':'08:30','horizon':'120'}, train=True)
        self.assertEqual(result['train_plan']['margin_minutes'], 5)
        self.assertEqual(result['train_plan']['arrive_by'], '2026-09-07T06:25:00.000Z')
        self.assertEqual(result['recommendation']['leave_home_at'], '2026-09-07T06:14:00.000Z')
        self.assertEqual(result['recommendation']['station_wait_minutes'], 5)

    def test_thurn_filter_and_line_page(self):
        result = self.calculate({'date':'2026-09-07','time':'08:00','stop':'thurn'})
        row = result['recommendation']
        self.assertEqual(row['line'],'88')
        self.assertEqual(row['walk_minutes'],11)
        self.assertEqual(row['origin']['id'],'1349')
        self.assertEqual(row['route_page_url'],'https://www.stib-mivb.be/startpagina/reizen/real-time/lijnen?line=88&direction=v')

    def test_stib_normalizer_accepts_new_88_platforms(self):
        result = server.normalize('stib', {'results':[{'pointid':'1349','lineid':'88','passingtimes':[{'destination':{'fr':'DE BROUCKERE'},'expectedArrivalTime':'2026-09-07T06:15:00Z'}]}]},1788760800)
        self.assertEqual(len(result['records']),1)
        self.assertEqual(result['records'][0]['line'],'88')
        self.assertEqual(result['records'][0]['stop'],'1349')

    def test_comparison_fields_and_preferred_stops(self):
        result=self.calculate({'date':'2026-09-07','time':'08:00','operator':'stib','limit':'20'})
        self.assertTrue(all(r['origin']['group']=='picard' for r in result['options'] if r['line']=='14'))
        row=result['recommendation']
        self.assertIn('id',row);self.assertIn('dominated',row)
        self.assertIsNone(row['departure_delay_seconds'])
        self.assertIsNotNone(row['scheduled_departure'])
        self.assertTrue(row['route_page_url'].endswith('direction=f'))
        self.assertEqual(row['journey_arrival'],row['arrival'])

    def test_stop_occupancy_is_preserved_without_inventing_missing_values(self):
        data=server.TIMETABLE['operators']['delijn']
        trip_id=next(iter(data['trips']))
        stop_id=next(iter(data['stops']))
        body={'header':{'timestamp':1788609600},'entity':[{'tripUpdate':{'trip':{'tripId':trip_id,'startDate':'20260905'},'stopTimeUpdate':[{'stopId':stop_id,'stopSequence':1,'scheduleRelationship':2,'departureOccupancyStatus':0}]}}]}
        normalized=server.normalize('delijn',body,1788609600)
        self.assertEqual(normalized['trips'][trip_id]['stops'][0]['occupancyStatus'],0)
        del body['entity'][0]['tripUpdate']['stopTimeUpdate'][0]['departureOccupancyStatus']
        normalized=server.normalize('delijn',body,1788609600)
        self.assertNotIn('occupancyStatus',normalized['trips'][trip_id]['stops'][0])

    def test_validation_and_missing_node(self):
        for query in [{'walking':'maybe'}, {'direction':'other'}, {'horizon':'99999'}, {'limit':'0'}, {'margin':'-1'}, {'date':'2026-02-30','time':'08:00'}]:
            with self.subTest(query=query), self.assertRaises(ValueError):
                server.validate_api_query(query)
        with patch.object(server.shutil, 'which', return_value=None):
            result, status = server.engine_response({})
            self.assertEqual(status, 503)
            self.assertIn('Node.js', result['error'])


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
            urlopen(self.base+'/api/next?walking=banana')
        self.assertEqual(got.exception.code,400)

    def test_docs_whitelist_and_no_arbitrary_file_serving(self):
        with urlopen(self.base+'/docs/AGENTS.md') as r:
            self.assertIn('Agent handoff',r.read().decode())
        with self.assertRaises(HTTPError) as got:
            urlopen(self.base+'/data/quota.json')
        self.assertEqual(got.exception.code,404)


if __name__ == '__main__':
    unittest.main()
