# Lays each <name>.wav at its time in marks.json (written by ../record_demo.js) over ../demo.webm -> docs/demo.mp4.
# Usage (from tools/voiceover/): python3 mix.py [path/to/ffmpeg] [te|hi]
# With a language: <lang>/marks.json, <lang>/<name>.wav and ../demo-<lang>.webm -> docs/demo-<lang>.mp4.
# Follow-up video: python3 mix.py <ffmpeg> <en|te|hi> followup -> followup/[<lang>/] files, ../followup-demo[-<lang>].webm,
# docs/followup/demo[-<lang>].mp4.
import json, subprocess, sys
ffmpeg = sys.argv[1] if len(sys.argv) > 1 else 'ffmpeg'
lang = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] != 'en' else ''
fu = len(sys.argv) > 3 and sys.argv[3] == 'followup'
d, suffix = (lang + '/', '-' + lang) if lang else ('', '')
if fu: d = 'followup/' + d
marks = [m for m in json.load(open(d + 'marks.json'))]
cmd = [ffmpeg, '-y', '-i', ('../followup-demo%s.webm' if fu else '../demo%s.webm') % suffix]
for name, _ in marks: cmd += ['-i', d + name + '.wav']
parts = ['[%d:a]adelay=%d:all=1[a%d]' % (i + 1, round(t * 1000), i) for i, (_, t) in enumerate(marks)]
parts.append(''.join('[a%d]' % i for i in range(len(marks)))
             + 'amix=inputs=%d:normalize=0,volume=1.1,alimiter=limit=0.8:level=0,apad[aout]' % len(marks))
cmd += ['-filter_complex', ';'.join(parts), '-map', '0:v', '-map', '[aout]', '-shortest',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '1', '-b:a', '96k',
        '-movflags', '+faststart', ('../../docs/followup/demo%s.mp4' if fu else '../../docs/demo%s.mp4') % suffix]
subprocess.run(cmd, check=True)
