# -*- coding: utf-8 -*-
"""Isolated, restartable ASR installation. stdout is a JSON-lines protocol."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request

REPO = 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'
PACKAGES = ['sherpa-onnx==2.0.0', 'numpy==2.0.2', 'imageio-ffmpeg==0.6.0']

def emit(stage, **values):
    print(json.dumps(dict(stage=stage, **values), ensure_ascii=True), flush=True)

def run(args, timeout=1200):
    # Do not expose pip diagnostics containing proxy credentials to the UI.
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            timeout=timeout, encoding='utf-8', errors='replace')
    if result.returncode:
        raise RuntimeError('程序检查或依赖安装失败；请检查 Python、磁盘空间和 PyPI 网络连接后重试。')
    return result.stdout.strip()

def digest(file, size, lfs):
    h = hashlib.sha256() if lfs else hashlib.sha1()
    if not lfs:
        h.update(('blob %d\0' % size).encode())
    with open(file, 'rb') as src:
        for chunk in iter(lambda: src.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def download(url, target, size, expected, lfs, opener=urllib.request.urlopen):
    if target.exists() and target.stat().st_size == size and digest(target, size, lfs) == expected:
        emit('download', file=target.name, received=size, total=size)
        return
    partial = target.with_suffix(target.suffix + '.part')
    try:
        with opener(url, timeout=45) as response, open(partial, 'wb') as out:
            received, last = 0, 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                received += len(chunk)
                if received > size:
                    raise RuntimeError('模型下载大小不符，请重试。')
                out.write(chunk)
                if time.monotonic() - last > .5:
                    emit('download', file=target.name, received=received, total=size)
                    last = time.monotonic()
        if partial.stat().st_size != size or digest(partial, size, lfs) != expected:
            raise RuntimeError('模型校验失败；文件未启用，请重试。')
        os.replace(partial, target)
    finally:
        if partial.exists():
            partial.unlink()

def main():
    root = Path(sys.argv[1]).resolve()
    root.mkdir(parents=True, exist_ok=True)
    env = root / 'venv'
    python = env / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    emit('environment')
    if not python.exists():
        run([sys.executable, '-m', 'venv', str(env)], 180)
    emit('packages')
    run([str(python), '-m', 'pip', '--isolated', 'install', '--disable-pip-version-check',
         '--no-input', '--only-binary=:all:', '--index-url', 'https://pypi.org/simple', *PACKAGES])
    emit('metadata')
    # Obtain a commit and authoritative hashes together, then download that commit.
    with urllib.request.urlopen('https://huggingface.co/api/models/' + REPO + '?blobs=true', timeout=45) as response:
        meta = json.loads(response.read(2 * 1024 * 1024))
    revision = meta.get('sha', '')
    if not re.fullmatch('[a-f0-9]{40}', revision):
        raise RuntimeError('模型版本信息无效，请稍后重试。')
    model = root / 'model'
    model.mkdir(exist_ok=True)
    for name in ['model.int8.onnx', 'tokens.txt']:
        entry = next(x for x in meta['siblings'] if x['rfilename'] == name)
        lfs = entry.get('lfs')
        size = entry.get('size') or (lfs or {}).get('size')
        expected = lfs.get('sha256') if lfs else entry.get('blobId')
        if not isinstance(size, int) or not 0 < size < 400 * 1024 * 1024 or not re.fullmatch('[a-f0-9]{%d}' % (64 if lfs else 40), expected or ''):
            raise RuntimeError('模型校验信息无效，请稍后重试。')
        download('https://huggingface.co/' + REPO + '/resolve/' + revision + '/' + name,
                 model / name, size, expected, bool(lfs))
    emit('check')
    check = Path(__file__).with_name('check_asr.py')
    ffmpeg = json.loads(run([str(python), str(check), str(model)], 180))['ffmpeg']
    emit('result', config={'asrExecutable': str(python),
         'asrArgs': json.dumps([str(Path(__file__).with_name('asr_cli.py').resolve()), '{file}', '--模型目录', str(model)], ensure_ascii=False),
         'ffmpegExecutable': ffmpeg})

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = str(error) if isinstance(error, RuntimeError) else '安装未完成；请检查网络、Python 环境和磁盘空间后重试（%s）。' % type(error).__name__
        emit('error', message=message)
        sys.exit(1)
