#!/usr/bin/env node
/**
 * check.mjs: look at a built video before the creator does (rules,
 * "Output and checks"). Every cut gets looked at, not just the first few
 * seconds.
 *
 *   node edit/check.mjs my-first-video
 *
 * Writes into <work>/edits/<slug>/:
 *   check-cuts.png    the last frame before and the first frame after every cut
 *   check-wave.png    the whole waveform, every cut marked in red
 *   check-frames.png  frames at 0%, 25%, 50%, 75% and at each overlay
 *   check.txt         the report below, also printed
 *
 * The report fails loudly on: picture and sound of different lengths, the
 * first word later than 0.3 s or too close to frame 1, a caption over the
 * chin or in the platform's text area, loudness away from the target, a
 * picture not in standard colour, and it lists to look at: a three-word run
 * said twice within 15 seconds (a retake left in), and every place the
 * captions and the sound differ, heard whole and again in short chunks.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG, FONT_FILE, FPS, ff, fileUrl, median, quantile, readJson, whisperArgs, workDir } from './lib.mjs';

const slug = process.argv[2];
if (!slug) { console.error('usage: node edit/check.mjs <slug>'); process.exit(2); }
const work = workDir(slug);
const tl = readJson(join(work, 'timeline.json'));
const video = tl.output;
const problems = [];
const lines = [`check: ${slug}`, `file: ${video}`];
const target = CONFIG.loudness.lufs;

// Lengths of picture and sound, as decoded.
const vInfo = ff(['-i', fileUrl(video), '-map', '0:v', '-f', 'null', '-'], { quiet: false });
const aInfo = ff(['-i', fileUrl(video), '-map', '0:a', '-af', 'ebur128', '-f', 'null', '-'], { quiet: false });
const frames = +(vInfo.match(/frame=\s*(\d+)/g)?.pop().match(/\d+/)[0] ?? 0);
const aTime = aInfo.match(/time=(\d+):(\d+):([\d.]+)/g)?.pop().match(/(\d+):(\d+):([\d.]+)/);
const aSec = aTime ? +aTime[1] * 3600 + +aTime[2] * 60 + +aTime[3] : 0;
const lufs = +(aInfo.match(/I:\s+(-?[\d.]+) LUFS/g)?.pop().match(/-?[\d.]+/)[0] ?? 0);
lines.push(`length: ${(frames / FPS).toFixed(2)} s picture, ${aSec.toFixed(2)} s sound, plan ${tl.total.toFixed(2)} s`);
if (Math.abs(frames / FPS - aSec) > 0.1) problems.push('picture and sound lengths differ by more than 0.1 s');
// Longer than the plan means pieces slipped late, and the captions with them.
if (Math.abs(frames / FPS - tl.total) > 0.05) problems.push('the picture runs longer or shorter than the plan: the captions drift');
lines.push(`loudness: ${lufs} LUFS (target ${target})`);
if (Math.abs(lufs - target) > 1.5) problems.push(`loudness ${lufs} LUFS is off target`);
// Rule 44: standard colour. HDR shows washed out or glaring on TikTok and Instagram.
const vStream = vInfo.match(/Video: .*/)?.[0] ?? '';
const sdr = /bt709/.test(vStream) && !/arib-std-b67|smpte2084|bt2020/.test(vStream);
lines.push(`colour: ${sdr ? 'standard (SDR, BT.709)' : vStream.match(/\(([^)]*)\)/)?.[1] ?? 'untagged'}`);
if (CONFIG.hdrToSdr && !sdr) problems.push('the picture is not tagged standard colour (rule 44)');

lines.push(`first word: ${tl.firstWord?.toFixed(2)} s`);
if (tl.firstWord > 0.3) problems.push('first word later than 0.3 s (rule 12)');
// Rule 12: the first word is heard whole, after some room tone. build.mjs
// measures where the voice starts in the raw clip (the finished file's own
// fade-in would read as silence).
if (tl.firstSound !== undefined) {
  lines.push(`first sound: ${tl.firstSound.toFixed(2)} s, after room tone (rule 12)`);
  if (tl.firstSound < Math.min(0.06, CONFIG.leadIn / 2)) problems.push('the first word starts too close to frame 1: its start may be clipped (rule 12)');
}
lines.push(`pieces: ${tl.pieces.length} (${tl.pieces.length - 1} cuts), captions: ${tl.captions.length}, overlays: ${tl.overlays.length}`);
if (tl.headline) {
  lines.push(`headline: "${tl.headline.text.replace(/\n/g, ' / ')}" ${tl.headline.border ? 'with border' : 'no border'}, on ${tl.headline.spans.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}`).join(', ')}`);
  if (!tl.headline.spans.length || tl.headline.spans[0][0] > 0) problems.push('headline is not on frame 1 (rule 23)');
  lines.push(`headline size: ${tl.headline.size}, capitals ${(tl.headline.capPct * 100).toFixed(1)}% of width (rule 26)`);
  if (tl.headline.capPct < CONFIG.headline.capMin - 0.0005) problems.push('headline smaller than rule 26 allows: reword or split it');
}
if (tl.ending) lines.push(`ending: "${tl.ending.text}" from ${tl.ending.from.toFixed(1)} s`);

// Captions against the face (rules 30 and 31): under the chin (where it sits
// nine times in ten at a desk, as build.mjs places them), or above the brows:
// on the hair, or on the wall above the head. The face box starts at the
// brows, the forehead takes about 0.06 of the frame above that, hair about 0.22.
if (tl.captionsOn !== false) {
  for (const clip of [...new Set(tl.pieces.map((p) => p.clip))]) {
    const kept = tl.pieces.filter((p) => p.clip === clip);
    const faces = readJson(join(work, 'face', `${clip}.json`))
      .filter((f) => f.bottom !== undefined && kept.some((p) => f.t >= p.in - 0.5 && f.t <= p.out + 0.5));
    const chin = tl.type === 'walking' ? median(faces.map((f) => f.bottom)) : quantile(faces.map((f) => f.bottom), 0.9);
    const brow = quantile(faces.map((f) => f.top), 0.1);
    const tops = kept.map((p) => p.capTop);
    const lowest = Math.max(...tops) + 0.05;
    const where = brow && lowest < brow - 0.22 ? 'above the head at' : brow && lowest < brow - 0.06 ? 'over the hair at' : 'from';
    lines.push(`${clip}: chin ${chin ? (chin * 100).toFixed(1) : '?'}%, captions ${where} ${(Math.min(...tops) * 100).toFixed(1)}%`);
    if (where === 'from' && chin && Math.min(...tops) < chin + 0.01) problems.push(`${clip}: a caption sits on the chin`);
    if (Math.max(...tops) > CONFIG.captions.safeBottom + 0.005) problems.push(`${clip}: a caption is in the platform text area`);
  }
  // Captions moved up never share the screen with the headline.
  if (tl.headline) {
    const headBottom = tl.headline.bottom ?? 0.3;
    const overHeadline = tl.captions.filter((c) => c.top < headBottom && tl.headline.spans.some(([a, b]) => c.start < b && c.end > a));
    if (overHeadline.length) problems.push(`${overHeadline.length} caption(s) over the headline`);
  }
}

// A retake left in: the same three words twice within 15 seconds. Only a
// note to look at, because people repeat phrases on purpose too.
const lookAt = [];
const words = tl.captions.flatMap((c) => c.text.toLowerCase().split(/\s+/).map((w) => ({ w, t: c.start })));
for (let i = 0; i + 2 < words.length; i++) {
  const tri = words.slice(i, i + 3).map((x) => x.w).join(' ');
  for (let j = i + 3; j + 2 < words.length && words[j].t - words[i].t < 15; j++) {
    if (words.slice(j, j + 3).map((x) => x.w).join(' ') === tri) {
      lookAt.push(`"${tri}" said at ${words[i].t.toFixed(1)} s and ${words[j].t.toFixed(1)} s: a retake left in?`);
    }
  }
}
// The longest pause left in, measured on the finished audio (rule 13).
const sil = ff(['-i', fileUrl(video), '-vn', '-af', `silencedetect=noise=${CONFIG.pauses.silenceDb}dB:d=0.3`, '-f', 'null', '-'], { quiet: false });
const gaps = [...sil.matchAll(/silence_duration: ([\d.]+)/g)].map((g) => +g[1]);
lines.push(`pauses over 0.3 s left: ${gaps.length}${gaps.length ? ` (longest ${Math.max(...gaps).toFixed(2)} s)` : ''}`);
if (CONFIG.pauses.on && gaps.some((g) => g > 0.6)) lookAt.push(`a pause of ${Math.max(...gaps).toFixed(2)} s is left in`);

// Captions against what the finished video says. Whisper's word times drift
// around long pauses, so a cut can drop a word the captions still show, or a
// caption can show the first word of a cut sentence. The finished sound is
// transcribed again and lined up with the captions word by word; every
// difference is listed to look at, because Whisper also mishears.
const nw = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '');
const shown = tl.captions.flatMap((c) => c.text.split(/[\s-]+/).map((w) => ({ w: nw(w), t: c.start }))).filter((x) => x.w);
/** Whisper's words ([{w, s}]) against the captions: the runs that differ. */
function differences(heard) {
  const said = heard.flatMap((x) => x.w.split(/[\s-]+/).map((w) => ({ w: nw(w), t: x.s }))).filter((x) => x.w);
  // Longest common subsequence, then the runs that differ.
  const L = Array.from({ length: shown.length + 1 }, () => new Uint16Array(said.length + 1));
  for (let i = shown.length - 1; i >= 0; i--) for (let j = said.length - 1; j >= 0; j--) {
    L[i][j] = shown[i].w === said[j].w ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const diffs = [];
  let i = 0; let j = 0; let run = null;
  const close = () => { if (run) diffs.push(run); run = null; };
  while (i < shown.length || j < said.length) {
    if (i < shown.length && j < said.length && shown[i].w === said[j].w) { close(); i++; j++; continue; }
    run ??= { t: (shown[i] ?? said[j]).t, shown: [], said: [] };
    if (j >= said.length || (i < shown.length && L[i + 1][j] >= L[i][j + 1])) run.shown.push(shown[i++].w);
    else run.said.push(said[j++].w);
  }
  close();
  return diffs;
}
const transcribe = (file, model) => {
  const r = spawnSync('python3', whisperArgs(file, model), { maxBuffer: 1 << 26 });
  return r.status === 0 ? JSON.parse(r.stdout).segments.flatMap((s) => s.words) : null;
};
const heard = transcribe(video, CONFIG.whisper.checkModel);
if (heard) {
  const diffs = differences(heard);
  lines.push(`captions against the sound: ${diffs.length} difference(s)`);
  for (const d of diffs) lookAt.push(`${d.t.toFixed(1)} s: captions "${d.shown.join(' ')}", heard "${d.said.join(' ')}"`);
} else {
  lookAt.push('could not transcribe the finished video to check the captions');
}
// Rule 18: a whole-video pass smooths over a half-word at a cut ("it'll, and
// then"). A smaller model listens again in chunks of about 8 s that start and
// end on cuts, so no word is split.
const chunks = [];
for (const p of tl.pieces) {
  if (!chunks.length || p.outStart - chunks.at(-1)[0] >= 8) chunks.push([p.outStart, p.outEnd]);
  else chunks.at(-1)[1] = p.outEnd;
}
// Each chunk is heard with 1.5 s either side, so a word at its edge isn't
// missed, and only the words starting inside it count.
const chunkWav = join(work, 'check-chunk.wav');
const inChunks = [];
for (const [a, b] of chunks) {
  const from = Math.max(0, a - 1.5);
  ff(['-ss', String(from), '-to', String(Math.min(tl.total, b + 1.5)), '-i', fileUrl(video), '-vn', '-ac', '1', '-ar', '16000', '-y', chunkWav]);
  inChunks.push(...(transcribe(chunkWav, CONFIG.whisper.chunkModel) ?? []).map((w) => ({ ...w, s: w.s + from }))
    .filter((w) => w.s >= a - 0.1 && w.s < b - 0.1));
}
// Only what the chunks hear that the captions don't show counts: a word
// missing at a chunk's edge is the chunking, and the whole pass covers it.
const chunkDiffs = differences(inChunks).filter((d) => d.said.length);
lines.push(`re-heard in ${chunks.length} chunks: ${chunkDiffs.length} sound(s) the captions don't show`);
for (const d of chunkDiffs) lookAt.push(`${d.t.toFixed(1)} s (chunks): captions "${d.shown.join(' ')}", heard "${d.said.join(' ')}"`);
if (tl.dropped?.length) lines.push(`wordless pieces dropped (no voice in them): ${tl.dropped.length}`);
for (const p of tl.pieces.filter((q) => q.unworded)) {
  lookAt.push(`${p.outStart.toFixed(1)} s: a voice with no word starting in it (${p.clip} ${p.in.toFixed(2)}-${p.out.toFixed(2)}): part of a word, or a mutter to cut?`);
}
for (const n of tl.notes ?? []) lines.push(`note ${n.start.toFixed(1)}-${n.end.toFixed(1)} s at ${(n.y * 100).toFixed(1)}%, size ${n.size}: "${n.text.replace(/\n/g, ' / ')}"`);

// Pictures: every cut, the waveform, a few frames.
const cuts = tl.pieces.slice(1).map((p) => p.outStart);
if (cuts.length) {
  const picks = cuts.flatMap((c) => [Math.round(c * FPS) - 1, Math.round(c * FPS)]);
  const cols = 12;
  ff(['-i', fileUrl(video), '-vf',
    `select='${picks.map((n) => `eq(n\\,${n})`).join('+')}',scale=180:-2,` +
    `drawtext=fontfile=${FONT_FILE}:text='%{pts\\:flt}':x=6:y=6:fontsize=20:fontcolor=yellow:box=1:boxcolor=black@0.7,` +
    `tile=${cols}x${Math.ceil(picks.length / cols)}:padding=4:color=white`,
    '-fps_mode', 'vfr', '-frames:v', '1', '-y', join(work, 'check-cuts.png')]);
}
const wave = `showwavespic=s=1800x240:colors=0x333333` +
  cuts.map((c) => `,drawbox=x=${Math.round((c / tl.total) * 1800)}:y=0:w=2:h=240:color=red@0.8:t=fill`).join('');
ff(['-i', fileUrl(video), '-filter_complex', `[0:a]aformat=channel_layouts=mono,${wave}`, '-frames:v', '1', '-y', join(work, 'check-wave.png')]);
const at = [0.05, tl.total * 0.25, tl.total * 0.5, tl.total * 0.75, ...tl.overlays.map((o) => (o.start + o.end) / 2)];
ff(['-i', fileUrl(video), '-vf',
  `select='${at.map((s) => `eq(n\\,${Math.round(s * FPS)})`).join('+')}',scale=360:-2,tile=${at.length}x1:padding=6:color=white`,
  '-fps_mode', 'vfr', '-frames:v', '1', '-y', join(work, 'check-frames.png')]);

lines.push('', problems.length ? `PROBLEMS (${problems.length}):` : 'no problems found', ...problems.map((p) => `  - ${p}`));
if (lookAt.length) lines.push('look at:', ...lookAt.map((p) => `  - ${p}`));
writeFileSync(join(work, 'check.txt'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
process.exit(problems.length ? 1 : 0);
