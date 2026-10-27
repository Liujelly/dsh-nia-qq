# -*- coding: utf-8 -*-
import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('install_asr', Path(__file__).parents[1] / 'tools/install_asr.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class DownloadTests(unittest.TestCase):
    def test_integrity_reuse_and_failed_replacement(self):
        data = b'fake-model'
        sha = hashlib.sha256(data).hexdigest()
        with tempfile.TemporaryDirectory(prefix='nia-asr-download-') as root:
            target = Path(root) / 'model.int8.onnx'
            mod.download('test', target, len(data), sha, True, lambda *a, **kw: io.BytesIO(data))
            self.assertEqual(target.read_bytes(), data)
            mod.download('test', target, len(data), sha, True, lambda *a, **kw: self.fail('valid cache downloaded again'))
            with self.assertRaises(RuntimeError):
                mod.download('test', target, len(data), '0'*64, True, lambda *a, **kw: io.BytesIO(b'bad'))
            self.assertEqual(target.read_bytes(), data)
            self.assertFalse(target.with_suffix('.onnx.part').exists())

    def test_git_blob_hash_for_tokens(self):
        data = b'hello\n'
        sha = hashlib.sha1(b'blob 6\0'+data).hexdigest()
        with tempfile.TemporaryDirectory(prefix='nia-asr-tokens-') as root:
            target = Path(root) / 'tokens.txt'
            mod.download('test',target,len(data),sha,False,lambda *a,**kw:io.BytesIO(data))
            self.assertEqual(target.read_bytes(),data)

if __name__ == '__main__':
    unittest.main()
