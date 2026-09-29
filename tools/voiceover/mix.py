# Lays each <name>.wav at its time in marks.json (written by ../record_demo.js) over ../demo.webm -> docs/demo.mp4.
# Usage (from tools/voiceover/): python3 mix.py [path/to/ffmpeg]
import json, subprocess, sys
ffmpeg = sys.argv[1] if len(sys.argv) > 1 else 'ffmpeg'
marks = [m for m in json.load(open('marks.json'))]
cmd = [ffmpeg, '-y', '-i', '../demo.webm']
for name, _ in marks: cmd += ['-i', name + '.wav']
parts = ['[%d:a]adelay=%d:all=1[a%d]' % (i + 1, round(t * 1000), i) for i, (_, t) in enumerate(marks)]
parts.append(''.join('[a%d]' % i for i in range(len(marks)))
             + 'amix=inputs=%d:normalize=0,volume=1.1,alimiter=limit=0.8:level=0,apad[aout]' % len(marks))
cmd += ['-filter_complex', ';'.join(parts), '-map', '0:v', '-map', '[aout]', '-shortest',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '1', '-b:a', '96k',
        '-movflags', '+faststart', '../../docs/demo.mp4']
subprocess.run(cmd, check=True)
