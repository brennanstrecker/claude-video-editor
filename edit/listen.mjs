#!/usr/bin/env node
/**
 * listen.mjs: hear one moment of a clip or a finished video, for the joins
 * the plan or check.mjs is unsure about (rules 6, 13 and 18).
 *
 *   node edit/listen.mjs hear  <file> <from> <to>     what two Whisper models hear there
 *   node edit/listen.mjs quiet <file> <from> <to>     loudness every 10 ms, and the quietest point
 *
 * "hear" settles what was said when the transcript and the sound disagree:
 * go with what both models hear, and treat a repeat that one model hears as
 * a real take until the sound proves otherwise. "quiet" finds where a cut can
 * go inside connected speech: only at a dip near room tone (about -55 dB or
 * lower). No dip means no cut: keep the whole sentence or none of it.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG, ff, ffmpeg, fileUrl, whisperArgs } from './lib.mjs';

const [mode, file, a, b] = process.argv.slice(2);
if (!['hear', 'quiet'].includes(mode) || !file || a === undefined || b === undefined) {
  console.error('usage: node edit/listen.mjs hear|quiet <file> <from> <to>');
  process.exit(2);
}

if (mode === 'hear') {
  const dir = mkdtempSync(join(tmpdir(), 'listen-'));
  const wav = join(dir, 'moment.wav');
  ff(['-ss', a, '-to', b, '-i', fileUrl(file), '-vn', '-ac', '1', '-ar', '16000', '-y', wav]);
  for (const model of [...new Set([CONFIG.whisper.chunkModel, CONFIG.whisper.model])]) {
    const r = spawnSync('python3', whisperArgs(wav, model), { maxBuffer: 1 << 24 });
    const words = r.status === 0 ? JSON.parse(r.stdout).segments.flatMap((s) => s.words) : [];
    console.log(`${model}: ${words.map((w) => `${w.w}@${(w.s + +a).toFixed(2)}`).join(' ') || '(nothing)'}`);
  }
  rmSync(dir, { recursive: true, force: true });
} else {
  const r = spawnSync(ffmpeg(), ['-v', 'error', '-ss', a, '-to', b, '-i', fileUrl(file), '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'],
    { maxBuffer: 1 << 26 });
  const pcm = new Int16Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 1);
  const steps = [];
  for (let i = 0; i + 160 <= pcm.length; i += 160) {
    let s = 0;
    for (let j = i; j < i + 160; j++) s += pcm[j] * pcm[j];
    steps.push([+a + i / 16000, 10 * Math.log10(s / 160 / 32768 ** 2 + 1e-12)]);
  }
  const q = steps.reduce((m, x) => (x[1] < m[1] ? x : m), [0, Infinity]);
  console.log(`quietest ${q[0].toFixed(2)} s at ${q[1].toFixed(1)} dB`);
  console.log(steps.map(([t, d]) => `${t.toFixed(2)}:${d.toFixed(0)}`).join(' '));
}
