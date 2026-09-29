# Speaks lines.json in an Indian English female voice (Kokoro "hf_alpha") -> <name>.wav + durations.json.
# pip install sherpa-onnx soundfile; download + untar kokoro-multi-lang-v1_0 from
# github.com/k2-fsa/sherpa-onnx/releases (tag tts-models) into this folder. Run from tools/voiceover/.
import json, sherpa_onnx, soundfile as sf
d = 'kokoro-multi-lang-v1_0/'
cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
    model=d + 'model.onnx', voices=d + 'voices.bin', tokens=d + 'tokens.txt', data_dir=d + 'espeak-ng-data',
    lexicon=d + 'lexicon-us-en.txt', dict_dir=d + 'dict'), num_threads=4))
tts = sherpa_onnx.OfflineTts(cfg)
out = {}
for name, text in json.load(open('lines.json')):
    a = tts.generate(text, sid=31, speed=0.95)          # 31 = hf_alpha (Indian female), 32 = hf_beta
    sf.write(name + '.wav', a.samples, a.sample_rate)
    out[name] = round(len(a.samples) / a.sample_rate, 2)
json.dump(out, open('durations.json', 'w'))
