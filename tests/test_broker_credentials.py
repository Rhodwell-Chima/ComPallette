import json
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.install_gateway_broker_password import update_password_file


class BrokerCredentialTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name, 'passwords')
        self.original = 'compallette-ingestion:$7$worker-hash\nGW-OTHER:$7$other-hash\n'
        self.path.write_text(self.original, encoding='utf-8')

    def test_hashes_only_new_plaintext_entry_and_preserves_other_accounts(self):
        credential = 'a' * 43

        def hash_file(command, **kwargs):
            self.assertEqual(command[:2], ['mosquitto_passwd', '-U'])
            self.assertNotIn(credential, command)
            temporary = Path(command[2])
            self.assertNotEqual(temporary, self.path)
            self.assertEqual(temporary.read_text(encoding='utf-8'), f'GW-NEW:{credential}\n')
            temporary.write_text('GW-NEW:$7$new-hash\n', encoding='utf-8')

        with patch('tools.install_gateway_broker_password.subprocess.run', side_effect=hash_file):
            update_password_file(self.path, 'GW-NEW', credential)
        self.assertEqual(self.path.read_text(encoding='utf-8'), self.original + 'GW-NEW:$7$new-hash\n')

    def test_hashing_failure_preserves_original_and_removes_plaintext_scratch(self):
        with patch('tools.install_gateway_broker_password.subprocess.run', side_effect=subprocess.CalledProcessError(1, 'mosquitto_passwd')):
            with self.assertRaises(subprocess.CalledProcessError):
                update_password_file(self.path, 'GW-NEW', 'b' * 43)
        self.assertEqual(self.path.read_text(encoding='utf-8'), self.original)
        self.assertEqual(list(Path(self.directory.name).iterdir()), [self.path])

    def test_revocation_removes_only_the_requested_gateway(self):
        update_password_file(self.path, 'GW-OTHER')
        self.assertEqual(self.path.read_text(encoding='utf-8'), 'compallette-ingestion:$7$worker-hash\n')

    def test_refuses_to_modify_worker_identity(self):
        with self.assertRaises(ValueError):
            update_password_file(self.path, 'compallette-ingestion')
        self.assertEqual(self.path.read_text(encoding='utf-8'), self.original)

    @unittest.skipIf(os.name == 'nt', 'POSIX ownership is verified in the Linux test container')
    def test_preserves_existing_broker_file_ownership_and_permissions(self):
        self.path.chmod(0o640)
        before = self.path.stat()
        update_password_file(self.path, 'GW-OTHER')
        after = self.path.stat()
        self.assertEqual((after.st_uid, after.st_gid), (before.st_uid, before.st_gid))
        self.assertEqual(stat.S_IMODE(after.st_mode), 0o640)
