# Speaks hi/lines.json in a Hindi female voice (Piper "Priyamvada") -> hi/<name>.wav + hi/durations.json.
# pip install sherpa-onnx soundfile; download + untar vits-piper-hi_IN-priyamvada-medium from
# github.com/k2-fsa/sherpa-onnx/releases (tag tts-models) into this folder. Run from tools/voiceover/.
import json, sherpa_onnx, soundfile as sf
d = 'vits-piper-hi_IN-priyamvada-medium/'
cfg = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(vits=sherpa_onnx.OfflineTtsVitsModelConfig(
    model=d + 'hi_IN-priyamvada-medium.onnx', tokens=d + 'tokens.txt', data_dir=d + 'espeak-ng-data'), num_threads=4))
tts = sherpa_onnx.OfflineTts(cfg)
out = {}
for name, text in json.load(open('hi/lines.json', encoding='utf-8')):
    a = tts.generate(text, sid=0, speed=0.95)
    sf.write('hi/' + name + '.wav', a.samples, a.sample_rate)
    out[name] = round(len(a.samples) / a.sample_rate, 2)
json.dump(out, open('hi/durations.json', 'w'))
