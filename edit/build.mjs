#!/usr/bin/env node
/**
 * build.mjs: turn an approved plan into the finished video.
 *
 *   node edit/build.mjs my-first-video            -> <Ready folder>/<HEADLINE>.mp4
 *   node edit/build.mjs my-first-video --test     -> <work>/edits/<slug>/test.mp4
 *
 * Reads the cut list in <work>/plans/<slug>.md (the first ```json block) plus
 * what scan.mjs measured. The plan says WHAT is kept (sentence ranges, chosen
 * by reading the transcript against the rules and the creator's profile); this
 * file does the mechanical part of the rules, each with its switch in
 * config.json:
 *
 *   rule 12  the first word gets some room tone before it, so it is heard whole
 *   rule 13  pauses inside a kept range shrink to about 0.12 s, with cut points
 *            taken from the real audio, and soft word starts kept
 *   rule 14  fillers (um, uh, erm) are cut
 *   rule 15  hard cuts, 30 ms audio fade either side
 *   rule 16  0.3 s of silence after the last word, never into the next word
 *   rule 18  sounds with no word in them (breaths, clicks) are dropped
 *   rules 23-33  headline, captions, borders only on light backgrounds,
 *            notes on screen, the ending text, the headline off while a
 *            screen shows
 *   rule 36  overlays at the word they belong to
 *
 * Every piece is cut to whole frames, so sound and picture stay in step
 * however many cuts there are, then the pieces are joined, the text and
 * overlays are drawn, and the sound is levelled in two passes.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CONFIG, EDIT, FONTS, FONT_FILE, FONT_NAME, FPS, H, READY, SPELLING, W, WORK, ff, ffmpeg, fileUrl, median,
  pictureFile, probe, quantile, readJson, readPlan, workDir,
} from './lib.mjs';

const slug = process.argv[2];
const TEST = process.argv.includes('--test');
if (!slug) { console.error('usage: node edit/build.mjs <slug> [--test]'); process.exit(2); }

const plan = readPlan(slug);
const work = workDir(slug);
const inv = readJson(join(work, 'inventory.json'));
const clipBy = Object.fromEntries(inv.clips.map((c) => [c.name, c]));
const data = (kind, clip) => readJson(join(work, kind, `${clip}.json`));

const C = CONFIG;
const GAP = C.pauses.on ? C.pauses.gap : Infinity; // rule 13: a pause longer than this is cut
const PAD_IN = C.pauses.padIn;    // kept before a word's start
const PAD_OUT = C.pauses.padOut;  // kept after a word's end (0.04 + 0.08 = the 0.12 s gap)
const LEAD_IN = C.leadIn;         // rule 12: room tone before the video's first word
const TAIL = C.tail;              // rule 16
const FILLERS = new Set(C.fillers.on ? C.fillers.words : []);
const LIGHT = 100;                // rule 29: mean brightness (0-255) above which white needs a border
const SAFE_BOTTOM = C.captions.safeBottom; // rule 30: caption top no lower than this (bottom edge about 0.78)
// Rule 27: below TikTok's and Instagram's top bars and inside the 3:4 profile
// grid crop (which drops the top 12.5%). The capitals start at about 14.5%.
const HEADLINE_Y = C.headline.y;
// Rule 26: the longest headline line fills 80% of the width, with capitals
// between 6% and 8% of the frame width tall.
const HEAD = { fill: C.headline.fill, capMin: C.headline.capMin, capMax: C.headline.capMax };
const HEADLINE_ON = C.headline.on && !!plan.headline?.text;
// Rule 36: screenshot area. A phone screen is tall, so height limits it; a
// desktop screen is wide, so it gets nearly the full width to stay readable.
const CARD = { top: 0.13, tall: { maxW: 0.8, maxH: 0.55 }, wide: { maxW: 0.94, maxH: 0.45 } };
// Rule 33: a note on screen. Bigger than a caption, smaller than the
// headline, and up long enough to read.
const NOTE = { fill: C.notes.fill, capMax: C.notes.capMax, min: C.notes.minSeconds };
// Rule 44: standard colour, tagged so no app guesses.
const BT709 = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];

// ---- 1. pieces: kept ranges, tightened -------------------------------------

/**
 * Pauses come from the audio, not from Whisper. Whisper's word timings
 * stretch a word over the silence after it (a "for" lasting six seconds), so
 * silencedetect, which hears the real gap, decides the cuts. Words are only
 * used to place captions and to cut fillers.
 */
const norm = (t) => t.toLowerCase().replace(/[^a-z']/g, '');
const subtract = (spans, a, b) => spans.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y]] : [[x, a], [b, y]].filter(([m, n]) => n > m)));
// silencedetect sometimes splits one pause in two around a 10 ms blip, which
// left a sliver of silence between two cuts. Pauses that nearly touch are one.
const silences = (clip) => data('silence', clip).reduce((out, [a, b]) => {
  const prev = out.at(-1);
  if (prev && prev[1] !== null && a - prev[1] < 0.05) prev[1] = b; else out.push([a, b]);
  return out;
}, []);
/** Where a clip has speech (edit/vad.py), cached beside the scan's files. */
const voiceCache = {};
function voice(clip) {
  const file = join(work, 'vad', `${clip}.json`);
  if (!existsSync(file)) {
    const r = spawnSync('python3', [join(EDIT, 'vad.py'), clipBy[clip].file], { maxBuffer: 1 << 24 });
    if (r.status !== 0) throw new Error(`vad.py failed on ${clip}: ${r.stderr}`);
    mkdirSync(join(work, 'vad'), { recursive: true });
    writeFileSync(file, r.stdout);
  }
  return (voiceCache[clip] ??= readJson(file));
}

/** A clip's raw sound as 10 ms loudness steps in dB, and its room tone. */
const levelCache = {};
function levels(clip) {
  if (levelCache[clip]) return levelCache[clip];
  const r = spawnSync(ffmpeg(), ['-v', 'error', '-i', fileUrl(clipBy[clip].file), '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'],
    { maxBuffer: 1 << 28 });
  const pcm = new Int16Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 1);
  const db = new Float32Array(Math.floor(pcm.length / 160));
  for (let i = 0; i < db.length; i++) {
    let s = 0;
    for (let j = i * 160; j < (i + 1) * 160; j++) s += pcm[j] * pcm[j];
    db[i] = 10 * Math.log10(s / 160 / 32768 ** 2 + 1e-12);
  }
  return (levelCache[clip] = { db, room: quantile([...db], 0.2) });
}
/**
 * Rule 13: where the voice after a pause really starts. silencedetect calls
 * anything under -45 dB silence, and a soft first sound ("s", "h", "f", a
 * quiet "and") sits under that, so starting PAD_IN before its end clipped the
 * word. When the voice detector's span reaching the pause's end starts up to
 * 0.15 s earlier, that is the word's real start. A span starting earlier still
 * is a quiet word of its own ("you know"), which stays cut.
 */
function onset(clip, b) {
  const s = voice(clip).find(([v0, v1]) => v0 <= b + 0.05 && v1 > b);
  return s && s[0] < b && s[0] >= b - 0.15 ? s[0] : b;
}

const pieces = [];
const dropped = [];
for (const k of plan.keep) {
  const clip = clipBy[k.clip];
  if (!clip) throw new Error(`plan names ${k.clip}, which is not in ${inv.group}`);
  // Rule 12: the video's first word gets LEAD_IN of room tone before it, so
  // it is heard whole. The range may start that much earlier, over room tone
  // only.
  let from = k.from;
  if (k === plan.keep[0] && LEAD_IN > 0) {
    const { db, room } = levels(k.clip);
    while (from > 0 && k.from - from < LEAD_IN && db[Math.floor((from - 0.01) * 100)] < room + 9) from -= 0.01;
  }
  let spans = [[from, Math.min(k.to, clip.duration)]];
  for (const [a, b0] of silences(k.clip)) {
    const b = b0 ?? clip.duration;
    if (b - a <= GAP && !(a <= from && b > from) && !(a < k.to && b >= k.to)) continue;
    // A pause keeps PAD_OUT after the speech before it and PAD_IN before the
    // next voice's real start; the range's own start and end snap to the
    // speech, and the first word keeps LEAD_IN.
    const lead = k === plan.keep[0] && a <= from ? LEAD_IN : PAD_IN;
    const cutFrom = a <= from ? from : a + PAD_OUT;
    const cutTo = b >= k.to ? k.to : Math.max(cutFrom, onset(k.clip, b) - lead);
    if (cutTo > cutFrom) spans = subtract(spans, cutFrom, cutTo);
  }
  // Whisper's word times drift around long pauses, so the words a range
  // captions can differ from the sound it keeps. "capFrom" and "capTo" in the
  // plan set the captioned words apart from the cut (a cut sentence's first
  // word, timed 0.8 s early, would otherwise be captioned). Rule 32: a range
  // that starts in a pause captions from the pause's start, because Whisper
  // often times the first word early, inside the pause, and the caption
  // lost it ("What my app does" captioned "my app does").
  const before = silences(k.clip).find(([a, b]) => a <= k.from && (b ?? clip.duration) >= k.from);
  const words = data('tx', k.clip).segments.flatMap((s) => s.words)
    .filter((w) => w.s >= (k.capFrom ?? (before ? before[0] : k.from)) - 0.02 && w.s < (k.capTo ?? k.to))
    .map((w) => ({ ...w }));
  // A kept range starts a sentence in the finished video ("So yeah, if
  // you're" becomes "If you're"), so its first word gets a capital.
  const firstWord = words.find((w) => !FILLERS.has(norm(w.w)));
  if (firstWord) firstWord.w = firstWord.w.charAt(0).toUpperCase() + firstWord.w.slice(1);
  for (const w of words) if (FILLERS.has(norm(w.w))) spans = subtract(spans, w.s - 0.02, w.e + 0.02);
  for (const [x, y] of spans) {
    const p = { clip: k.clip, in: Math.max(0, Math.floor(x * FPS) / FPS), out: Math.min(clip.duration, Math.ceil(y * FPS) / FPS), words: [] };
    if (p.out - p.in >= 2 / FPS) pieces.push(p);
  }
  // Each word belongs to the piece it starts in, or the next one if Whisper
  // put its start inside a cut pause. A word Whisper timed after the range's
  // sound ends goes on the last piece: the plan's caption range decides what
  // is captioned, so a sentence keeps its last word.
  const mine = pieces.filter((p) => p.clip === k.clip && p.in >= Math.floor(from * FPS) / FPS - 1e-6);
  for (const w of words) {
    if (FILLERS.has(norm(w.w))) continue;
    const p = mine.find((q) => w.s < q.out - 0.02) ?? mine.at(-1);
    if (p) p.words.push(w);
  }
  // Rule 18: a piece with no word starting in it is either a breath, a lip
  // noise or a click left in a long pause (it goes), or part of a word
  // Whisper timed elsewhere ("limita... tions" across a pause: it stays).
  // Silero VAD tells them apart; check.mjs flags any kept one to look at.
  if (!C.dropWordless) continue;
  const speech = voice(k.clip);
  for (const p of mine) {
    if (p.words.length) continue;
    if (speech.reduce((s, [a, b]) => s + Math.max(0, Math.min(b, p.out) - Math.max(a, p.in)), 0) >= 0.1) { p.unworded = true; continue; }
    dropped.push(p);
    pieces.splice(pieces.indexOf(p), 1);
  }
}
// Two pieces of one clip that touch become one.
for (let i = pieces.length - 1; i > 0; i--) {
  const a = pieces[i - 1]; const b = pieces[i];
  if (a.clip === b.clip && b.in <= a.out + 1 / FPS) {
    a.out = Math.max(a.out, b.out); a.words.push(...b.words); pieces.splice(i, 1);
  }
}
// Rule 16: the tail runs through silence only, so ending on one word never
// pulls in the start of the next. No pause after the last word, no tail.
const last = pieces[pieces.length - 1];
const lastDur = clipBy[last.clip].duration;
const after = silences(last.clip).find(([a, b]) => a <= last.out + 0.02 && (b ?? lastDur) > last.out);
if (after) last.out = Math.min(lastDur, (after[1] ?? lastDur) - PAD_IN, Math.ceil((last.out + TAIL) * FPS) / FPS);
// Rule 12, for check.mjs: how much room tone comes before the first voice.
const firstSound = (() => {
  const { db, room } = levels(pieces[0].clip);
  let i = Math.ceil(pieces[0].in * 100);
  while (i < db.length && db[i] <= room + 9) i++;
  return i / 100 - pieces[0].in;
})();

let t = 0;
for (const p of pieces) {
  p.frames = Math.round((p.out - p.in) * FPS);
  p.outStart = t; t += p.frames / FPS; p.outEnd = t;
}
const total = t;
const toOut = (clip, s) => {
  const p = pieces.find((q) => q.clip === clip && s < q.out);
  if (!p) return null;
  return p.outStart + Math.max(0, s - p.in);
};

// ---- 2. measurements: chin and background brightness ---------------------

/** Mean brightness of a band of the frame at one moment, 0-255. */
function brightness(clip, at, y0, y1, x0 = 0.15, x1 = 0.85) {
  const r = spawnSync(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-ss', String(at), '-i', fileUrl(clipBy[clip].file),
    '-frames:v', '1', '-vf',
    `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
    `crop=${Math.round((x1 - x0) * W)}:${Math.round((y1 - y0) * H)}:${Math.round(x0 * W)}:${Math.round(y0 * H)},scale=1:1,format=gray`,
    '-f', 'rawvideo', '-']);
  return r.stdout[0] ?? 0;
}

const chinCache = {};
function chinFor(p) {
  const key = plan.type === 'walking' ? `${p.clip}@${p.in}` : p.clip;
  if (chinCache[key] === undefined) {
    // Only where the clip is kept: people lean in or look away between takes.
    const kept = plan.type === 'walking' ? [p] : pieces.filter((q) => q.clip === p.clip);
    const faces = data('face', p.clip).filter((f) => f.bottom !== undefined &&
      kept.some((q) => f.t >= q.in - 0.5 && f.t <= q.out + 0.5));
    // At a desk people settle lower as they talk, so the captions go under
    // where the chin sits nine times in ten, not where it sits on average.
    chinCache[key] = plan.type === 'walking' ? median(faces.map((f) => f.bottom)) : quantile(faces.map((f) => f.bottom), 0.9);
  }
  return chinCache[key];
}

let lastTop = 0.72;
for (const p of pieces) {
  const chin = chinFor(p);
  // Rule 30: just under the chin, never in the platform's text area. Rule
  // 31: a clip where the creator sits so close that the chin is in that area
  // gets its captions above the head instead ("captionTop": {"IMG_1234": 0.14}).
  p.capTop = plan.captionTop?.[p.clip] ?? (chin ? Math.min(SAFE_BOTTOM, chin + 0.02) : lastTop);
  lastTop = p.capTop;
  const mid = (p.in + p.out) / 2;
  p.capBorder = brightness(p.clip, mid, p.capTop, p.capTop + 0.045) > LIGHT;
}

// ---- 3. captions -----------------------------------------------------------

const censor = (w) => (C.captions.censor ? w.replace(/\b(f)uck/gi, '$1***').replace(/\b(s)hit/gi, '$1***') : w);
function spell(text) {
  let s = text;
  for (const [from, to] of Object.entries(SPELLING)) s = s.replace(new RegExp(`\\b${from}\\b`, 'gi'), to);
  return s;
}

const outWords = [];
for (const p of pieces) {
  for (const w of p.words) {
    if (FILLERS.has(norm(w.w))) continue;
    const s = p.outStart + Math.max(0, w.s - p.in);
    const e = p.outStart + Math.min(p.out, w.e) - p.in;
    if (w.w.startsWith('-') && outWords.length) { outWords[outWords.length - 1].w += w.w; continue; } // "full -time"
    outWords.push({ w: w.w, s, e, piece: p });
  }
}

// Caption fixes from the plan ({"going to": "gonna"}): Whisper tidies speech,
// and rule 11 says the captions show the words as they were said.
for (const [from, to] of Object.entries(plan.captionFixes || {})) {
  const seq = from.toLowerCase().split(/\s+/);
  for (let i = 0; i + seq.length <= outWords.length; i++) {
    const run = outWords.slice(i, i + seq.length);
    if (run.map((x) => norm(x.w)).join(' ') !== seq.map(norm).join(' ')) continue;
    const punct = run.at(-1).w.match(/[.?!,]$/)?.[0] ?? '';
    // The fix becomes separate words spread over the run's time, so a full
    // stop inside it ("app. So and it's") still breaks the caption.
    const parts = (to + punct).split(/\s+/);
    const step = (run.at(-1).e - run[0].s) / parts.length;
    outWords.splice(i, seq.length, ...parts.map((w, n) => ({ ...run[0], w, s: run[0].s + n * step, e: run[0].s + (n + 1) * step })));
    i += parts.length - 1;
  }
}

// One to four words a caption (rule 32), breaking after punctuation, and
// never leaving a little word like "my" or "the" hanging at the end of one.
const MAX_WORDS = C.captions.maxWords;
const MAX_CHARS = C.captions.maxChars;
const WEAK = new Set(['a', 'an', 'the', 'my', 'your', 'to', 'of', 'and', 'i', "i've", "i'm", 'in', 'on', 'for', 'with', 'is', 'be']);
const groups = [];
let grp = [];
for (const w of outWords) {
  const text = [...grp, w].map((x) => x.w).join(' ');
  // A word that finishes a sentence may make one more, so it is not left alone.
  const ends = /[.?!,]$/.test(w.w);
  const full = grp.length && (grp.length >= (ends ? MAX_WORDS + 1 : MAX_WORDS) ||
    text.length > (ends ? MAX_CHARS + 6 : MAX_CHARS) || /[.?!,]$/.test(grp.at(-1).w));
  if (full) {
    let carry = [];
    // The whole word, not norm(): norm("9-to-5") is "to", which left "a" alone.
    while (grp.length > 1 && !/[.?!,]$/.test(grp.at(-1).w) && WEAK.has(grp.at(-1).w.toLowerCase())) carry.unshift(grp.pop());
    groups.push(grp);
    grp = carry;
  }
  grp.push(w);
}
if (grp.length) groups.push(grp);
// A caption fix written "QR~codes" stays one word for grouping and shows a
// space, so the two words never land in different captions.
const captions = groups.map((g) => ({ text: g.map((x) => x.w).join(' ').replace(/~/g, ' '), start: g[0].s, end: g.at(-1).e, piece: g[0].piece }));
for (let i = 0; i < captions.length; i++) {
  const c = captions[i];
  const next = captions[i + 1];
  c.end = next ? (next.start - c.end < 0.6 ? next.start : c.end + 0.2) : total;
  c.text = censor(spell(c.text)).replace(/[.,;:]+$/g, '').replace(/[.,;:](?=\s|$)/g, '');
}

// ---- 4. headline, ending, notes, overlays, screens -----------------------

const overlays = (plan.overlays || []).map((o) => {
  const start = toOut(o.clip, o.at);
  if (start === null) throw new Error(`overlay at ${o.clip} ${o.at}s is not in a kept piece`);
  return { ...o, start, end: Math.min(total, start + o.dur) };
});
// Rule 33: a note says what the creator meant by a line that could be
// misread, or sharpens a loose description of the product. It shows from the
// line's first word to its last, at least NOTE.min, in the headline's place,
// or just under the captions when they sit at the top (rule 31).
const notes = (C.notes.on ? plan.notes || [] : []).map((n) => {
  const start = toOut(n.clip, n.from);
  const to = toOut(n.clip, n.to);
  if (start === null || to === null) throw new Error(`note at ${n.clip} ${n.from}-${n.to}s is not in a kept piece`);
  const piece = pieces.find((p) => p.outEnd > start);
  const y = piece.capTop < 0.3 ? piece.capTop + 0.055 : HEADLINE_Y;
  const mid = piece.in + (start - piece.outStart);
  return { ...n, start, end: Math.min(total, Math.max(to, start + NOTE.min)), y, border: brightness(piece.clip, mid, y, y + 0.1) > LIGHT };
});
// Rule 27: a screen in the frame takes the headline off. Overlays count, and
// so do ranges the plan marks as showing a monitor or laptop, and notes in
// the headline's place.
const screens = [
  ...overlays.map((o) => [o.start, o.end]),
  ...(plan.screens || []).map((s) => [toOut(s.clip, s.from), toOut(s.clip, s.to)]),
  ...notes.filter((n) => n.y === HEADLINE_Y).map((n) => [n.start, n.end]),
];
const endingFrom = plan.ending ? Math.max(0, total - (plan.ending.seconds || 2.5)) : total;

const show = plan.headline?.show || (plan.type === 'day' ? 'first-scene' : 'whole');
const headUntil = show === 'whole' ? endingFrom
  : show === 'first-scene' ? Math.max(3, pieces.filter((p) => p.clip === pieces[0].clip).at(-1).outEnd)
  : Math.min(endingFrom, +show);
let headSpans = HEADLINE_ON ? [[0, headUntil]] : [];
for (const [a, b] of screens) {
  headSpans = headSpans.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y]] : [[x, a], [b, y]].filter(([m, n]) => n - m > 0.05)));
}
const headBorder = brightness(pieces[0].clip, pieces[0].in + 0.1, HEADLINE_Y - 0.01, HEADLINE_Y + 0.15) > LIGHT;

/** Text widths in the caption font, from measure.py. */
function measure(text) {
  const r = spawnSync('python3', [join(EDIT, 'measure.py'), FONT_FILE, ...text.split('\n')]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return JSON.parse(r.stdout.toString());
}
/** Rule 26 in numbers: the font size for a headline or ending text. */
function headSize(text) {
  const m = measure(text);
  const fit = (HEAD.fill * W * m.cellUnits) / Math.max(...m.lines);
  const byCap = (pct) => (pct * W * m.cellUnits) / m.capUnits;
  // Rule 26: when the first scene's captions sit just under the headline
  // (rule 31), the headline also ends above them: each line takes about 1.2
  // times its size, and a gap of 0.012 of the frame is left.
  const capsTop = C.captions.on && pieces[0].capTop < 0.4 ? pieces[0].capTop - 0.012 : 1;
  const byRoom = ((capsTop - HEADLINE_Y) * H) / (text.split('\n').length * 1.2);
  const size = Math.round(Math.min(fit, byCap(HEAD.capMax), byRoom));
  const capPct = (m.capUnits * size) / m.cellUnits / W;
  if (capPct < HEAD.capMin) console.warn(`"${text}" is too long for rule 26 (capitals ${(capPct * 100).toFixed(1)}% of width): reword it or split the line`);
  return { size, capPct };
}
const headFit = HEADLINE_ON ? headSize(plan.headline.text) : null;
const endFit = plan.ending ? headSize(plan.ending.text) : null;

/** A note's font size: its longest line fills NOTE.fill of the width, capped. */
function noteSize(text) {
  const m = measure(text);
  return Math.round(Math.min((NOTE.fill * W * m.cellUnits) / Math.max(...m.lines), (NOTE.capMax * W * m.cellUnits) / m.capUnits));
}
for (const n of notes) n.size = noteSize(n.text);

// ---- 5. the text file (ASS: plain text, no animation) --------------------

const ts = (s) => {
  const cs = Math.round(s * 100);
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:` +
    `${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
const esc = (s) => s.replace(/\\/g, '').replace(/[{}]/g, '').replace(/\n/g, '\\N');
const ass = [
  '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
  '[V4+ Styles]',
  'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  `Style: Headline,${FONT_NAME},84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,8,90,90,0,1`,
  `Style: Caption,${FONT_NAME},${C.captions.size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,8,150,150,0,1`,
  '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
];
const head = (a, b, text, fit, border) =>
  ass.push(`Dialogue: 1,${ts(a)},${ts(b)},Headline,,0,0,0,,{\\an8\\pos(${W / 2},${Math.round(HEADLINE_Y * H)})\\fs${fit.size}${border ? `\\bord${Math.round(fit.size / 22)}` : ''}}${esc(text)}`);
for (const [a, b] of headSpans) head(a, b, plan.headline.text, headFit, headBorder);
if (plan.ending) head(endingFrom, total, plan.ending.text, endFit, headBorder);
if (C.captions.on) {
  for (const c of captions) {
    const onScreen = overlays.some((o) => c.start < o.end && c.end > o.start && o.mode !== 'card');
    const border = c.piece.capBorder || onScreen;
    ass.push(`Dialogue: 0,${ts(c.start)},${ts(c.end)},Caption,,0,0,0,,{\\an8\\pos(${W / 2},${Math.round(c.piece.capTop * H)})${border ? `\\bord${Math.round(C.captions.size / 18)}` : ''}}${esc(c.text)}`);
  }
}
for (const n of notes) {
  // \q2: the plan's own line breaks only. The caption style's margins would
  // wrap a note's 86%-wide line into three.
  ass.push(`Dialogue: 1,${ts(n.start)},${ts(n.end)},Caption,,0,0,0,,{\\an8\\q2\\pos(${W / 2},${Math.round(n.y * H)})\\fs${n.size}${n.border ? `\\bord${Math.round(n.size / 18)}` : ''}}${esc(n.text)}`);
}
writeFileSync(join(work, 'text.ass'), ass.join('\n') + '\n');

// ---- 6. render -------------------------------------------------------------

const piecesDir = join(work, 'pieces');
rmSync(piecesDir, { recursive: true, force: true });
mkdirSync(piecesDir, { recursive: true });
const list = [];
// Rule 44: the picture comes from the standard-colour copy, the sound from the
// clip itself. Both copies share one timeline.
const sdrDir = join(work, 'sdr');
const picture = Object.fromEntries([...new Set(pieces.map((p) => p.clip))].map((c) => [c, pictureFile(clipBy[c].file, sdrDir)]));
pieces.forEach((p, i) => {
  const dur = p.frames / FPS;
  const out = join(piecesDir, `${String(i).padStart(3, '0')}.mkv`);
  // Rule 37: a part of a filmed screen that fails the privacy check is
  // blurred for the seconds it shows ("blurs" in the plan: clip times, and
  // x, y, w, h as parts of the output frame).
  const blur = (plan.blurs || []).filter((b) => b.clip === p.clip && b.from < p.out && b.to > p.in).map((b, n) => {
    const [x, y, w, h] = [b.x * W, b.y * H, b.w * W, b.h * H].map(Math.round);
    return `,split=2[m${n}][b${n}];[b${n}]crop=${w}:${h}:${x}:${y},boxblur=${C.blur.radius}:${C.blur.power}[bl${n}];` +
      `[m${n}][bl${n}]overlay=${x}:${y}:enable='between(t,${(b.from - p.in).toFixed(3)},${(b.to - p.in).toFixed(3)})'`;
  }).join('');
  ff(['-ss', p.in.toFixed(4), '-i', fileUrl(picture[p.clip]), '-ss', p.in.toFixed(4), '-i', fileUrl(clipBy[p.clip].file),
    '-t', dur.toFixed(4), '-map', '0:v:0', '-map', '1:a:0',
    // Both streams start at 0 and the picture has exactly p.frames frames. A
    // phone clip's frames can sit half a frame off the cut point; without
    // this the fps filter dropped the first frame, and each such piece pushed
    // the rest of the video about a frame late.
    '-vf', `setpts=PTS-STARTPTS,fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1` +
      `${blur},tpad=stop_mode=clone:stop_duration=1`,
    '-af', `asetpts=PTS-STARTPTS,aresample=48000,apad,atrim=0:${dur.toFixed(4)},afade=t=in:d=0.03,` +
      `afade=t=out:st=${Math.max(0, dur - 0.03).toFixed(4)}:d=0.03`,
    '-frames:v', String(p.frames),
    '-c:v', 'libx264', '-crf', '14', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', ...BT709,
    '-c:a', 'pcm_s16le', '-ac', '2', '-y', out]);
  list.push(`file '${out}'`);
});
writeFileSync(join(work, 'pieces.txt'), list.join('\n') + '\n');

// Loudness, pass 1: measure.
const LOUD = `loudnorm=I=${C.loudness.lufs}:TP=${C.loudness.truePeak}:LRA=11`;
const meas = ff(['-f', 'concat', '-safe', '0', '-i', join(work, 'pieces.txt'), '-vn',
  '-af', `${LOUD}:print_format=json`, '-f', 'null', '-'], { quiet: false });
const m = JSON.parse(meas.slice(meas.lastIndexOf('{'), meas.lastIndexOf('}') + 1));

const inputs = ['-f', 'concat', '-safe', '0', '-i', join(work, 'pieces.txt')];
let vchain = '[0:v]null[v0]';
overlays.forEach((o, i) => {
  // Overlay paths are absolute, or relative to the work folder.
  const file = isAbsolute(o.file) ? o.file : join(WORK, o.file);
  const isImage = /\.(png|jpe?g|webp)$/i.test(file);
  inputs.push(...(isImage ? ['-loop', '1', '-t', String(o.dur)] : ['-ss', String(o.from || 0), '-t', String(o.dur)]), '-i', fileUrl(file));
  const src = probe(file);
  const box = src.width > src.height ? CARD.wide : CARD.tall;
  // A card gets a thin dark edge so a light screen doesn't melt into a light wall.
  const fit = o.mode === 'full'
    ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`
    : `scale=${Math.round(box.maxW * W) - 6}:${Math.round(box.maxH * H) - 6}:force_original_aspect_ratio=decrease,` +
      'format=rgba,pad=iw+6:ih+6:3:3:color=black@0.35';
  // A card starts lower ("top" in the plan) where the captions sit at the top.
  const y = o.mode === 'full' ? 0 : Math.round((o.top ?? CARD.top) * H);
  vchain += `;[${i + 1}:v]${fit},setsar=1,fps=${FPS},setpts=PTS-STARTPTS+${o.start.toFixed(3)}/TB[o${i}]` +
    `;[v${i}][o${i}]overlay=x=(W-w)/2:y=${y}:eof_action=pass:enable='between(t,${o.start.toFixed(3)},${o.end.toFixed(3)})'[v${i + 1}]`;
});
vchain += `;[v${overlays.length}]ass=filename=${join(work, 'text.ass')}:fontsdir=${FONTS}[v]`;
const achain = `[0:a]${LOUD}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:` +
  `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000[a]`;

// The headline as a file name, minus characters Finder dislikes and a closing
// full stop ("NOW I HAVE TO..mp4" otherwise).
const name = (plan.file || plan.headline?.text?.replace(/\n/g, ' ') || slug)
  .replace(/[/:\\?*"<>|]/g, '').replace(/[.\s]+$/, '').trim();
const outDir = TEST ? work : READY;
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, TEST ? 'test.mp4' : `${name}.mp4`);
ff([...inputs, '-filter_complex', `${vchain};${achain}`, '-map', '[v]', '-map', '[a]',
  '-r', String(FPS), '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', ...BT709,
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', fileUrl(outFile)]);
// The standard-colour copies are about 1 GB a minute; a test build keeps them
// for the final one.
if (!TEST) rmSync(sdrDir, { recursive: true, force: true });
const cover = outFile.replace(/\.mp4$/, '-cover.jpg');
ff(['-i', fileUrl(outFile), '-frames:v', '1', '-q:v', '2', '-y', fileUrl(cover)]);

writeFileSync(join(work, 'timeline.json'), JSON.stringify({
  slug, type: plan.type, output: outFile, total, firstWord: captions[0]?.start ?? null, firstSound,
  captionsOn: C.captions.on,
  headline: HEADLINE_ON ? {
    text: plan.headline.text, spans: headSpans, border: headBorder, size: headFit.size, capPct: headFit.capPct,
    bottom: HEADLINE_Y + (plan.headline.text.split('\n').length * headFit.size * 1.2) / H, // about: lines x line height
  } : null,
  ending: plan.ending ? { text: plan.ending.text, from: endingFrom } : null,
  pieces: pieces.map(({ clip, in: a, out: b, outStart, outEnd, capTop, capBorder, unworded }) =>
    ({ clip, in: a, out: b, outStart, outEnd, capTop, capBorder, ...(unworded && { unworded }) })),
  captions: captions.map(({ text, start, end, piece }) => ({ text, start, end, top: piece.capTop, clip: piece.clip })),
  overlays: overlays.map(({ file, start, end, mode }) => ({ file, start, end, mode })),
  notes: notes.map(({ text, start, end, y, size }) => ({ text, start, end, y, size })),
  dropped: dropped.map(({ clip, in: a, out: b }) => ({ clip, in: a, out: b })),
}, null, 2));

console.log(`${pieces.length} pieces, ${captions.length} captions, ${overlays.length} overlay(s), ${notes.length} note(s), ` +
  `${dropped.length} wordless piece(s) dropped, ${total.toFixed(1)} s`);
console.log(`-> ${outFile}`);
if (!existsSync(outFile)) process.exit(1);
