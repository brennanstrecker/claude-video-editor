#!/usr/bin/env node
/**
 * scan.mjs: read one group of raw clips so a plan can be written from it.
 *
 *   node edit/scan.mjs "My first video"      one folder in the raw folder
 *   node edit/scan.mjs --all                  every folder there
 *
 * For each clip, in recording order (rule 19):
 *   - Whisper word timings, with the word list                tx/<clip>.json
 *   - the real silences in the audio (rule 13)                silence/<clip>.json
 *   - where the face sits, every half second (rule 30)        face/<clip>.json
 *
 * Then one compact text file, pack.txt, that Claude reads to write the plan:
 * every word with its start time, pauses marked, the chin position per clip.
 * Everything is cached: a second run only reads clips it has not seen.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import {
  CONFIG, RAW, faceBin, ff, fileUrl, median, probe, readJson, slugify, whisperArgs, workDir,
} from './lib.mjs';

const args = process.argv.slice(2);
const groups = args.includes('--all')
  ? readdirSync(RAW, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : args.filter((a) => !a.startsWith('--'));
if (!groups.length) {
  console.error('usage: node edit/scan.mjs "<folder in the raw folder>" | --all');
  process.exit(2);
}

/**
 * Below this level counts as silence. A quiet room measures about -64 dB;
 * -38 dB swallowed soft word starts, -45 dB does not. A noisy room may need
 * it raised in config.json (pauses.silenceDb).
 */
const SILENCE_DB = CONFIG.pauses.silenceDb;
const SILENCE_MIN = 0.15;

function silences(clip) {
  const err = ff(['-i', fileUrl(clip), '-vn', '-af', `silencedetect=noise=${SILENCE_DB}dB:d=${SILENCE_MIN}`, '-f', 'null', '-'], { quiet: false });
  const out = [];
  let start = null;
  for (const line of err.split('\n')) {
    const s = line.match(/silence_start: (-?[\d.]+)/);
    const e = line.match(/silence_end: ([\d.]+)/);
    if (s) start = Math.max(0, +s[1]);
    if (e && start !== null) { out.push([+start.toFixed(3), +(+e[1]).toFixed(3)]); start = null; }
  }
  if (start !== null) out.push([+start.toFixed(3), null]); // runs to the end
  return out;
}

for (const group of groups) {
  const dir = join(RAW, group);
  if (!existsSync(dir)) { console.error(`no folder: ${dir}`); process.exit(1); }
  const slug = slugify(group);
  const work = workDir(slug);
  const clips = readdirSync(dir)
    .filter((f) => /\.(mov|mp4|m4v)$/i.test(f))
    .map((f) => ({ file: join(dir, f), name: basename(f, extname(f)), ...probe(join(dir, f)) }))
    .sort((a, b) => a.created.localeCompare(b.created) || a.name.localeCompare(b.name));

  console.log(`${group}: ${clips.length} clip(s) -> ${work}`);
  for (const c of clips) {
    const tx = join(workDir(slug, 'tx'), `${c.name}.json`);
    if (!existsSync(tx)) {
      process.stdout.write(`  ${c.name}: transcribing (${c.duration.toFixed(0)} s)... `);
      const r = spawnSync('python3', whisperArgs(c.file, CONFIG.whisper.model), { maxBuffer: 1 << 26 });
      if (r.status !== 0) throw new Error(r.stderr.toString().slice(-2000));
      writeFileSync(tx, r.stdout);
      console.log('done');
    }
    const sil = join(workDir(slug, 'silence'), `${c.name}.json`);
    if (!existsSync(sil)) writeFileSync(sil, JSON.stringify(silences(c.file)));
    const face = join(workDir(slug, 'face'), `${c.name}.json`);
    if (!existsSync(face)) {
      const r = spawnSync(faceBin(), [c.file, '0.5'], { maxBuffer: 1 << 26 });
      if (r.status !== 0) throw new Error(r.stderr.toString());
      const rows = r.stdout.toString().trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
      writeFileSync(face, JSON.stringify(rows));
    }
  }

  // The pack: what Claude reads. Words with start times, pauses over 0.3 s
  // marked with their length, a blank line at every pause over 1 s.
  const lines = [`# ${group}`, `slug: ${slug}`, `clips in recording order: ${clips.map((c) => c.name).join(', ')}`, ''];
  for (const c of clips) {
    const tx = readJson(join(work, 'tx', `${c.name}.json`));
    const faces = readJson(join(work, 'face', `${c.name}.json`)).filter((f) => f.bottom !== undefined);
    const chin = median(faces.map((f) => f.bottom));
    const found = faces.length / Math.max(1, Math.ceil(c.duration / 0.5));
    lines.push(`## ${c.name}  ${c.duration.toFixed(1)} s  recorded ${c.created}  ` +
      `${c.width}x${c.height}${c.rotation ? ` rot ${c.rotation}` : ''}  ` +
      `face in ${(found * 100).toFixed(0)}% of samples${chin ? `, chin at ${(chin * 100).toFixed(0)}%` : ''}`);
    let prev = 0;
    let row = [];
    const flush = () => { if (row.length) lines.push(row.join(' ')); row = []; };
    for (const s of tx.segments) {
      for (const w of s.words) {
        const gap = w.s - prev;
        if (gap > 1) { flush(); lines.push(`  ... ${gap.toFixed(1)} s pause`); }
        else if (gap > 0.3) row.push(`|${gap.toFixed(1)}|`);
        row.push(`${w.w}@${w.s.toFixed(2)}`);
        prev = w.e;
        if (row.length >= 14) flush();
      }
    }
    flush();
    lines.push(`  (last word ends ${prev.toFixed(2)} s; clip ends ${c.duration.toFixed(2)} s)`, '');
  }
  writeFileSync(join(work, 'pack.txt'), lines.join('\n'));
  writeFileSync(join(work, 'inventory.json'), JSON.stringify({ group, slug, clips }, null, 2));
  console.log(`  pack: ${join(work, 'pack.txt')}`);
}
