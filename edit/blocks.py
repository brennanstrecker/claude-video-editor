"""blocks.py: hear every kept sound block of a built video on its own (rule 48).

  python3 edit/blocks.py <slug>

check.mjs listens to the finished video whole and in 8 s chunks, and both
passes smooth over a short false start inside a kept line ("tool, to c... to
complete" was heard as "tool to complete"). Heard on its own, a stutter comes
out as words that are not in the line, and a stray word comes out as itself.

For each kept piece in timeline.json, each voice span (vad/<clip>.json, made
by build.mjs) inside it is cut out of the raw clip and transcribed with the
config's "blockModel" (medium.en by default). Read the list against the
captions: any block whose words are not the line's words is a false start or
a stray word to cut, or to explain in the plan. Whisper often mangles a short
block's real words, so hear a doubtful one again before cutting.
"""
import json
import os
import subprocess
import sys
from os.path import dirname, expanduser, join

import imageio_ffmpeg
import numpy as np
from faster_whisper import WhisperModel

SR = 16000
ROOT = join(dirname(__file__), '..')
CONFIG = json.load(open(os.environ.get('VIDEO_EDIT_CONFIG') or join(ROOT, 'config.json')))


def audio(media, a, b):
    out = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-loglevel', 'error', '-ss', str(a), '-to', str(b),
         '-i', 'file:' + media, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
        capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.float32)


def main() -> int:
    if len(sys.argv) < 2:
        print('usage: blocks.py <slug>', file=sys.stderr)
        return 2
    work = join(expanduser(CONFIG['workFolder']), 'edits', sys.argv[1])
    timeline = json.load(open(join(work, 'timeline.json')))
    if timeline.get('sound') == 'off':
        print('sound is off (rule 51): nothing to hear')
        return 0
    files = {c['name']: c['file'] for c in json.load(open(join(work, 'inventory.json')))['clips']}
    name = CONFIG['whisper'].get('blockModel', 'medium.en')
    model = WhisperModel(name, device='cpu', compute_type='int8')
    lang = 'en' if name.endswith('.en') else None
    for p in timeline['pieces']:
        for v0, v1 in json.load(open(join(work, 'vad', f"{p['clip']}.json"))):
            a, b = max(v0, p['in']), min(v1, p['out'])
            if b - a < 0.08:
                continue
            segs, _ = model.transcribe(audio(files[p['clip']], a, b), language=lang, beam_size=5)
            text = ' '.join(s.text.strip() for s in segs)
            print(f"{p['outStart'] + a - p['in']:6.2f} s  {p['clip']} {a:7.2f}-{b:7.2f}: {text}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
