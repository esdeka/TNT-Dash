"""De Lijn stop API adapter checks. Payload fixtures follow the official schema;
no live key, borrowed website credential or real upstream request is used.
"""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.request import HTTPRedirectHandler
import json
import unittest
import delijn_live as DL
import server
from mobility_config import load_config as bmc_config

KEY='fictional-delijn-key-for-tests-only'
STOPS=['gs:delijn:310790','gs:delijn:303916']

def payload(status='REALTIME',expected='2026-09-07T08:17:42+0200',cancelled=False):
    return {'halteDoorkomstenLijst':[{'halteDoorkomsten':[{'haltenummer':'310790','doorkomsten':[{
        'doorkomstId':'2026-09-07_3241_29_24_310790','entiteitnummer':'3','lijnnummer':241,'ritnummer':'29','richting':'TERUG','haltenummer':'310790',
        'dienstregelingTijdstip':'2026-09-07T08:11:00+0200','doorkomstTijdstip':expected,'predictionStatussen':[status],
        'vrtnum':'2659','bestemmingKort':'Brussel Noord','status':'CANCELLED' if cancelled else ''}]}]}]}

class DeLijnStopTests(unittest.TestCase):
    def test_private_key_batch_and_redirect_safety(self):
        c=DL.load_config({'DELIJN_API_KEY':KEY})
        r=c.request(STOPS)
        self.assertIn('/haltes/lijst/3_303916_3_310790/real-time',r.full_url)
        self.assertEqual(r.get_header('Ocp-apim-subscription-key'),KEY)
        self.assertNotIn(KEY,r.full_url);self.assertNotIn(KEY,repr(c))
        redirected=HTTPRedirectHandler().redirect_request(r,None,302,'',{},'https://example.org/file')
        self.assertIsNone(redirected.get_header('Ocp-apim-subscription-key'))
        with self.assertRaises(ValueError):DL.load_config({}).request(STOPS)

    def test_normalized_paired_times_and_journey_identity(self):
        d=DL.normalize(payload(),STOPS,1000);r=d['records'][0]
        self.assertEqual(r['journeyId'],'2026-09-07_3241_29')
        self.assertEqual(r['vehicleId'],'2659')
        self.assertEqual(r['expected']-r['planned'],402)
        self.assertTrue(r['realtime']);self.assertEqual(r['stop'],'gs:delijn:310790')
        self.assertEqual(d['kind'],'stop-api')

    def test_early_unknown_cancelled_and_passed_are_distinct(self):
        r=DL.normalize(payload(expected='2026-09-07T08:09:00+0200'),STOPS,1000)['records'][0]
        self.assertEqual(r['expected']-r['planned'],-120)
        r=DL.normalize(payload(status='GEENREALTIME'),STOPS,1000)['records'][0]
        self.assertIsNone(r['expected']);self.assertFalse(r['realtime'])
        r=DL.normalize(payload(status='GESCHRAPT'),STOPS,1000)['records'][0];self.assertTrue(r['cancelled'])
        r=DL.normalize(payload(status='VERSTREKEN'),STOPS,1000)['records'][0];self.assertTrue(r['passed']);self.assertFalse(r['cancelled'])

    def test_date_only_or_unknown_shape_is_not_a_fake_midnight_departure(self):
        self.assertIsNone(DL.timestamp('2026-09-07'))
        p=payload();p['halteDoorkomstenLijst'][0]['halteDoorkomsten'][0]['doorkomsten'][0]['dienstregelingTijdstip']='2026-09-07'
        with self.assertRaises(ValueError):DL.normalize(p,STOPS,1000)
        with self.assertRaises(ValueError):DL.normalize({},STOPS,1000)
        self.assertEqual(DL.normalize({'halteDoorkomstenLijst':[]},STOPS,1000)['records'],[])

    def test_separate_key_source_and_quota_accounting(self):
        with TemporaryDirectory() as tmp, \
             patch.object(server,'CONFIG',bmc_config({})), \
             patch.object(server,'DL_CONFIG',DL.load_config({'DELIJN_API_KEY':KEY})), \
             patch.object(server,'STATE',{'providers':{},'lastAttempt':0}), \
             patch.object(server,'QUOTA',server.migrate_quota({'calls':[999]})), \
             patch.object(server,'STATE_PATH',Path(tmp)/'state.json'), \
             patch.object(server,'QUOTA_PATH',Path(tmp)/'quota.json'), \
             patch.object(server.time,'time',return_value=1000), \
             patch.object(server,'fetch_provider',side_effect=lambda op:(op,{'ok':True,'fetchedAt':1000})) as fetch:
            data=server.get_live(True,automatic=False)
            self.assertEqual(fetch.call_count,2)
            self.assertEqual(data['quota']['used'],2) # retained anonymous call + one STIB call
            self.assertEqual(data['quota']['delijnStop']['used'],1)
            self.assertEqual(data['access']['delijnSource'],'stop-api')
            self.assertFalse(data['access']['autoRefreshAllowed']) # Existing global BMC-key rule preserved.
            self.assertNotIn(KEY,json.dumps(data))

if __name__=='__main__':unittest.main()
