"""Optional HA package syntax / template tests, NOT a running HA OS validation.
Requires PyYAML and Jinja2. Run: python -m unittest -v test_ha_config.py
"""
from pathlib import Path
import unittest
try:
    import yaml
    from jinja2.nativetypes import NativeEnvironment
    AVAILABLE = True
except ImportError:
    AVAILABLE = False
ROOT = Path(__file__).resolve().parent


@unittest.skipUnless(AVAILABLE, 'Install PyYAML and Jinja2 for optional configuration tests')
class HomeAssistantConfigTests(unittest.TestCase):
    def load(self):
        class Loader(yaml.SafeLoader):
            pass
        Loader.add_constructor('!secret', lambda loader,node: loader.construct_scalar(node))
        return yaml.load((ROOT/'home_assistant/commute.yaml').read_text(),Loader=Loader)

    def test_yaml_structure_and_unique_entities(self):
        config = self.load()
        sensors = config['template'][0]['sensor']
        self.assertEqual(len(sensors),7)
        self.assertEqual(len({s['unique_id'] for s in sensors}),7)
        self.assertEqual(config['rest'][0]['scan_interval'],60)
        self.assertEqual(config['rest_command']['commute_refresh_live']['method'],'POST')
        for filename in ['ha_app/config.yaml','home_assistant/optional_live_refresh.yaml','home_assistant/secrets.example.yaml']:
            self.assertIsInstance(yaml.safe_load((ROOT/filename).read_text()),dict)
        app = yaml.safe_load((ROOT/'ha_app/config.yaml').read_text())
        self.assertFalse(app['options']['refresh_schedules_on_start'])
        self.assertEqual(set(app['arch']),{'aarch64','amd64'})

    def test_timestamp_templates_and_unavailable_data(self):
        fixture = {'leave_home_at':'2026-09-07T06:01:00.000Z','departure':'2026-09-07T06:06:00.000Z',
                   'arrival':'2026-09-07T06:12:00.000Z','origin':{'name':'PICARD'},'line':'14',
                   'quality':'scheduled','walk_minutes':5,'staff_only':False}
        for available in [True,False]:
            with self.subTest(available=available):
                attrs = {'recommendation':fixture if available else None,
                    'next_by_operator':{o:fixture if available else None for o in ['shuttle','stib','delijn']}}
                env = NativeEnvironment()
                env.globals.update(state_attr=lambda eid,key:attrs.get(key),has_value=lambda eid:available)
                for sensor in self.load()['template'][0]['sensor']:
                    self.assertEqual(env.from_string(sensor['availability']).render(),available)
                    value = env.from_string(sensor['state']).render()
                    if available:
                        self.assertIsInstance(value,str)
                        self.assertEqual(value,value.strip())
                        self.assertTrue(value.endswith('Z'))
                    else:
                        self.assertIsNone(value)
                    for expression in sensor.get('attributes',{}).values():
                        env.from_string(expression).render()


class AppDataSelectionTests(unittest.TestCase):
    def test_new_88_scope_is_not_masked_by_newer_old_scope_data(self):
        from ha_app.run import select_timetable
        bundled={'operators':{'stib':{'fetchedAt':'2026-09-05','stopScopeVersion':2},'delijn':{'fetchedAt':'2026-09-04'}}}
        persistent={'operators':{'stib':{'fetchedAt':'2026-09-06'},'delijn':{'fetchedAt':'2026-09-06'}}}
        result=select_timetable(bundled,persistent)
        self.assertEqual(result['operators']['stib'],bundled['operators']['stib'])
        self.assertEqual(result['operators']['delijn'],persistent['operators']['delijn'])
        self.assertEqual(bundled['operators']['delijn']['fetchedAt'],'2026-09-04')

    def test_newer_compatible_data_and_first_start(self):
        from ha_app.run import select_timetable
        bundled={'operators':{'stib':{'fetchedAt':'2026-09-05','stopScopeVersion':2}}}
        persistent={'operators':{'stib':{'fetchedAt':'2026-09-06','stopScopeVersion':2}}}
        self.assertEqual(select_timetable(bundled,persistent),persistent)
        self.assertEqual(select_timetable(bundled,None),bundled)


if __name__ == '__main__':
    unittest.main()
