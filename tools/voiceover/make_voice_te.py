# Speaks te/lines.json in a Telugu female voice (AI4Bharat Indic-TTS FastPitch + HiFi-GAN) -> te/<name>.wav + te/durations.json.
# Needs Coqui TTS in a fresh virtual environment (python3.11 -m venv venv; venv/bin/pip install -U pip setuptools wheel;
# venv/bin/pip install TTS==0.22.0) and te.zip from github.com/AI4Bharat/Indic-TTS/releases (tag v1-checkpoints-release)
# unzipped into this folder as indic-tts-te/. Run from tools/voiceover/ with that environment's python.
import os; os.environ['TORCH_FORCE_WEIGHTS_ONLY_LOAD'] = '1'   # model files are read as plain data, never run as code
import json, numpy as np, soundfile as sf

def tidy(a, sr, pause=0.45, edge=0.1, quiet=0.01):
    """Shortens pauses (the model leaves 1-2 s between sentences) and evens the loudness with the Hindi voice."""
    a = np.asarray(a, dtype=np.float32)
    q = np.r_[0, (np.abs(a) < quiet).astype(np.int8), 0]
    runs = np.flatnonzero(np.diff(q)).reshape(-1, 2)
    keep = np.ones(len(a), bool)
    for s, e in runs:
        lim = int((edge if s == 0 or e == len(a) else pause) * sr)
        if e - s > lim: keep[s + lim // 2:e - lim // 2] = False
    a = a[keep]
    return a * (10 ** (-1.5 / 20) / np.max(np.abs(a)))   # peak at -1.5 dB
from TTS.utils.synthesizer import Synthesizer
d = 'indic-tts-te/te/'
cfg = open(d + 'fastpitch/config.json', encoding='utf-8').read().replace('models/v1/te/', d)   # authors' folder -> ours
open(d + 'fastpitch/config_local.json', 'w', encoding='utf-8').write(cfg)
syn = Synthesizer(tts_checkpoint=d + 'fastpitch/best_model.pth', tts_config_path=d + 'fastpitch/config_local.json',
                  tts_speakers_file=d + 'fastpitch/speakers.pth', vocoder_checkpoint=d + 'hifigan/best_model.pth',
                  vocoder_config=d + 'hifigan/config.json', use_cuda=False)
import sys; base = sys.argv[1] if len(sys.argv) > 1 else ''   # e.g. 'followup/' for the Follow-up video
out = {}
for name, text in json.load(open(base + 'te/lines.json', encoding='utf-8')):
    wav = tidy(syn.tts(text, speaker_name='female'), syn.output_sample_rate)
    sf.write(base + 'te/' + name + '.wav', wav, syn.output_sample_rate)
    out[name] = round(len(wav) / syn.output_sample_rate, 2)
json.dump(out, open(base + 'te/durations.json', 'w'))
