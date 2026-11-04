#!/usr/bin/env python3
"""The final retained manifest moves both security pins and preserves history."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'bootstrapper'))
spec = importlib.util.spec_from_file_location('security_exporter', ROOT / 'bootstrapper/record-recovery-images.py')
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)
security = json.loads((ROOT / 'gitlab/security-release.json').read_text())


class SecurityExport(unittest.TestCase):
    def test_both_completed_security_images_replace_active_public_selectors_without_discarding_old_archives(self):
        old = {'archives': [{'file': 'images/old.tar.gz', 'imageId': 'sha256:' + '1' * 64}],
               'localImages': [{'tag': 'system_bootstrapper', 'imageId': 'sha256:' + '1' * 64}],
               'publicImages': [{'reference': security['fromImage'], 'tag': security['fromImage'].split('@')[0]},
                                {'reference': security['runner']['fromImage'], 'tag': security['runner']['fromImage'].split('@')[0]}],
               'currentController': {'reference': 'controller:old', 'imageId': 'sha256:' + '1' * 64}}
        before = copy.deepcopy(old)
        archive = {'file': 'images/new.tar.gz', 'imageId': 'sha256:' + '2' * 64}
        value = exporter.refreshed_manifest(old, archive, ('a' * 40, 'b' * 40, 'c' * 40),
                                            'controller:new', archive['imageId'], security['toImage'],
                                            'sha256:' + '3' * 64, 'wizard:retained',
                                            security['runner']['toImage'], 'sha256:' + '4' * 64)
        self.assertEqual(old, before)
        self.assertEqual(value['archives'][0], before['archives'][0])
        self.assertEqual(value['controllerHistory'], [before['currentController']])
        self.assertEqual({row['reference'] for row in value['publicImages']},
                         {security['toImage'], security['runner']['toImage']})
        self.assertEqual(value['publicImages'][1]['imageId'], 'sha256:' + '4' * 64)
        with self.assertRaisesRegex(exporter.recovery.RecoveryError, 'Runner-public-image-declaration'):
            exporter.refreshed_manifest({**old, 'publicImages': old['publicImages'][:1]}, archive,
                                        ('a' * 40, 'b' * 40, 'c' * 40), 'controller:new', archive['imageId'],
                                        security['toImage'], 'sha256:' + '3' * 64, 'wizard:retained',
                                        security['runner']['toImage'], 'sha256:' + '4' * 64)


if __name__ == '__main__':
    unittest.main()
