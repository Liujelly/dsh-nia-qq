# -*- coding: utf-8 -*-
import json
from pathlib import Path
import subprocess
import sys
import numpy as np
import sherpa_onnx
import imageio_ffmpeg

model = Path(sys.argv[1])
rec = sherpa_onnx.OfflineRecognizer.from_sense_voice(
    model=str(model / 'model.int8.onnx'), tokens=str(model / 'tokens.txt'),
    num_threads=2, use_itn=True)
stream = rec.create_stream()
stream.accept_waveform(16000, np.zeros(16000, dtype=np.float32))
rec.decode_stream(stream)
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
subprocess.run([ffmpeg, '-version'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print(json.dumps({'ffmpeg': ffmpeg}))
