#!/usr/bin/env node
/**
 * send.mjs: a finished video to the creator's iPhone, byte for byte the file
 * in the Ready folder (rule 45).
 *
 *   node edit/send.mjs                      the newest video in Ready, by AirDrop
 *   node edit/send.mjs launch               the Ready video whose name has these words (a slug works too)
 *   node edit/send.mjs launch tips          several videos in one go
 *   node edit/send.mjs launch --icloud      to iCloud Drive instead, for when they are away from the Mac
 *   node edit/send.mjs launch --check       finds the files and checks AirDrop, sends nothing
 *
 * AirDrop opens the Mac's AirDrop window with the video in it. Click the
 * iPhone and it lands in Photos, where TikTok and Instagram pick from. With
 * --icloud the file goes to iCloud Drive (the folder named in config.json)
 * and shows in the Files app; save it to Photos from there. Email is not
 * used: Gmail stops at 25 MB and these videos are usually 30 to 100 MB.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CONFIG, READY, swiftBin } from './lib.mjs';

const args = process.argv.slice(2);
const ICLOUD = args.includes('--icloud');
const CHECK = args.includes('--check');
const wanted = args.filter((a) => !a.startsWith('--'));

const simple = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const videos = readdirSync(READY).filter((f) => f.endsWith('.mp4'))
  .map((f) => ({ name: f, path: join(READY, f), mtime: statSync(join(READY, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);
if (!videos.length) { console.error(`nothing in ${READY}`); process.exit(1); }

const files = wanted.length ? wanted.map((w) => {
  const found = videos.filter((v) => simple(v.name).includes(simple(w)));
  if (found.length === 1) return found[0];
  console.error(found.length
    ? `"${w}" matches ${found.length} videos: ${found.map((v) => v.name).join(', ')}`
    : `no video in Ready matches "${w}". Ready has: ${videos.map((v) => v.name).join(', ')}`);
  process.exit(1);
}) : [videos[0]];

const mb = (p) => `${(statSync(p).size / 1e6).toFixed(0)} MB`;
for (const f of files) console.log(`${f.name} (${mb(f.path)})`);
const phone = swiftBin('phone');

if (ICLOUD) {
  const drive = join(homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
  if (!existsSync(drive)) { console.error('iCloud Drive is off on this Mac'); process.exit(1); }
  const dir = join(drive, CONFIG.phone.icloudFolder);
  if (CHECK) { console.log(`ready: would copy to ${dir}`); process.exit(0); }
  mkdirSync(dir, { recursive: true });
  const copies = files.map((f) => { const to = join(dir, f.name); copyFileSync(f.path, to); return to; });
  // Wait for iCloud to say every copy is up, so "it's on your phone" is true.
  const deadline = Date.now() + 10 * 60 * 1000;
  let waiting = copies;
  while (waiting.length && Date.now() < deadline) {
    waiting = waiting.filter((c) => spawnSync(phone, ['uploaded', c]).stdout.toString().trim() !== '1');
    if (waiting.length) spawnSync('sleep', ['3']);
  }
  if (waiting.length) {
    console.error(`still uploading after 10 minutes: ${waiting.length} file(s). It finishes on its own.`);
    process.exit(1);
  }
  console.log(`on iCloud: on the iPhone, Files > iCloud Drive > ${CONFIG.phone.icloudFolder}, then Share > Save Video`);
} else {
  const r = spawnSync(phone, [CHECK ? 'check' : 'airdrop', ...files.map((f) => f.path)], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('AirDrop did not send. To try iCloud instead: node edit/send.mjs <name> --icloud');
    process.exit(1);
  }
  if (!CHECK) console.log('on the iPhone: in Photos');
}
