#!/usr/bin/env python3
"""
transcribe.py: Whisper word timings for one media file. scan.mjs, check.mjs
and listen.mjs call it.

  python3 edit/transcribe.py <media> <model> [word list]

faster-whisper rather than openai-whisper: same model weights, CTranslate2
instead of PyTorch, so the install is about 200 MB rather than 2 GB and it
runs on a Mac's CPU at a usable speed. compute_type is int8 and device is
cpu, deliberately.

Writes JSON to stdout:

  {"language": "en", "duration": 21.4, "segments": [
     {"start": 0.0, "end": 3.2, "text": "...", "words": [{"w":"this","s":0.0,"e":0.2}]}
  ]}

Word timestamps are the point: they let a cut be an exact range rather than
an eyeballed one.
"""
import json
import sys

from faster_whisper import WhisperModel


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: transcribe.py <media> <model> [word list]", file=sys.stderr)
        return 2
    path, model_name = sys.argv[1], sys.argv[2]
    # Optional third argument: names Whisper should expect (your product, the
    # tools you mention). Without it Whisper spells unusual names by ear.
    prompt = sys.argv[3] if len(sys.argv) > 3 else None

    # The first run of a model downloads it (~/.cache/huggingface); after that
    # it works offline.
    model = WhisperModel(model_name, device="cpu", compute_type="int8")

    segments, info = model.transcribe(
        path,
        word_timestamps=True,
        initial_prompt=prompt,
        # Skips silence rather than inventing speech over it.
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 500},
    )

    out = []
    for s in segments:
        out.append({
            "start": round(s.start, 3),
            "end": round(s.end, 3),
            "text": s.text.strip(),
            "words": [
                {"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3)}
                for w in (s.words or [])
            ],
        })

    json.dump({
        "language": info.language,
        "languageProbability": round(info.language_probability, 3),
        "duration": round(info.duration, 3),
        "segments": out,
    }, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
