"""vad.py: where a clip has speech, by Silero VAD (bundled with faster-whisper).

    python3 edit/vad.py <clip> > vad/<clip>.json

Prints [[start, end], ...] in seconds. build.mjs uses it to tell a word Whisper
timed in the wrong place (speech: kept) from a breath, a lip noise or a
click left in a pause (not speech: dropped), rule 18.
"""

import json
import sys

from faster_whisper.audio import decode_audio
from faster_whisper.vad import VadOptions, get_speech_timestamps

RATE = 16000
audio = decode_audio(sys.argv[1], sampling_rate=RATE)
# Short words count ("are", "so"), and no padding: the spans say where the
# voice is, not where a cut may go.
spans = get_speech_timestamps(audio, VadOptions(min_speech_duration_ms=60, min_silence_duration_ms=100, speech_pad_ms=0))
print(json.dumps([[round(s['start'] / RATE, 3), round(s['end'] / RATE, 3)] for s in spans]))
