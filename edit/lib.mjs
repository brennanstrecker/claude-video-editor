/**
 * lib.mjs: shared settings and helpers for the video editor.
 *
 * The rules this code follows are rules/video-rules.md, and the creator's own
 * profile/my-profile.md wins over them. How the steps fit together:
 *
 *   node edit/scan.mjs "My first video"     transcripts, silences, face positions
 *   (Claude writes <work>/plans/<slug>.md, and the creator picks the headline)
 *   node edit/build.mjs my-first-video      the finished file in the Ready folder
 *   node edit/check.mjs my-first-video      cut sheet, waveform and report
 *
 * Every setting lives in config.json, or in the file VIDEO_EDIT_CONFIG names.
 * Raw footage never leaves its folder; working files go to the work folder.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EDIT = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(EDIT);

const home = (p) => p.replace(/^~(?=\/|$)/, homedir());
const configFile = process.env.VIDEO_EDIT_CONFIG || join(ROOT, 'config.json');
/** config.json: folders, and a switch or a number for every rule the scripts enforce. */
export const CONFIG = JSON.parse(readFileSync(configFile, 'utf8'));

/** One folder per video inside it (rule 19). */
export const RAW = home(CONFIG.rawFolder);
export const READY = home(CONFIG.readyFolder);
/** Plans, scan data and test renders. Big temporary files live here too. */
export const WORK = home(CONFIG.workFolder);
export const FONTS = join(EDIT, 'fonts');
export const FONT_FILE = join(FONTS, CONFIG.font.file);
export const FONT_NAME = CONFIG.font.name;
export const TRANSCRIBE = join(EDIT, 'transcribe.py');

/** Output frame. Every source is scaled and cropped to this. */
export const W = CONFIG.frame.width;
export const H = CONFIG.frame.height;
export const FPS = CONFIG.frame.fps;

/**
 * Names Whisper should expect (your product, tools, places), from the
 * profile's word list. Write it as punctuated sentences: Whisper copies the
 * prompt's style, and a bare comma list makes it drop full stops, which
 * merges sentences in the captions.
 */
export const WORD_LIST = CONFIG.whisper.wordList || '';
/** How captions spell names Whisper gets wrong: {"chat gpt": "ChatGPT"}. */
export const SPELLING = CONFIG.spelling || {};

export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function workDir(slug, ...sub) {
  const d = join(WORK, 'edits', slug, ...sub);
  mkdirSync(d, { recursive: true });
  return d;
}

/** Whisper with the word list, as transcribe.py's arguments. */
export const whisperArgs = (file, model) => [TRANSCRIBE, file, model, ...(WORD_LIST ? [WORD_LIST] : [])];

let ffmpegPath;
/** The pip imageio-ffmpeg build, which includes libass for the text. */
export function ffmpeg() {
  if (!ffmpegPath) {
    ffmpegPath = execFileSync('python3', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'])
      .toString().trim();
  }
  return ffmpegPath;
}

/**
 * Runs ffmpeg and returns stderr (where it reports). Paths are passed as
 * "file:" URLs because a folder named like "Scrap:Old" would otherwise be
 * read as a protocol.
 */
export function ff(args, { quiet = true } = {}) {
  const r = spawnSync(ffmpeg(), ['-hide_banner', ...(quiet ? ['-loglevel', 'error'] : []), ...args], {
    maxBuffer: 1 << 28,
  });
  const err = r.stderr.toString();
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}):\n${err.slice(-3000)}`);
  return err;
}

export const fileUrl = (p) => `file:${p}`;

/** Duration, size, rotation and recording time from ffmpeg's own report. */
export function probe(path) {
  const r = spawnSync(ffmpeg(), ['-hide_banner', '-i', fileUrl(path)]);
  const info = r.stderr.toString();
  const d = info.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const created = info.match(/com\.apple\.quicktime\.creationdate\s*:\s*(\S+)/) || info.match(/creation_time\s*:\s*(\S+)/);
  const size = info.match(/Video:.*?(\d{3,5})x(\d{3,5})/);
  const rot = info.match(/rotation of (-?[\d.]+)/);
  return {
    duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0,
    created: created ? created[1] : statSync(path).birthtime.toISOString(),
    width: size ? +size[1] : 0,
    height: size ? +size[2] : 0,
    rotation: rot ? +rot[1] : 0,
    hdr: /Video:.*(arib-std-b67|smpte2084)/.test(info),
  };
}

/** A Swift helper in edit/, compiled on first use and again after it changes. */
export function swiftBin(name) {
  const src = join(EDIT, `${name}.swift`);
  const bin = join(WORK, 'bin', name);
  if (!existsSync(bin) || statSync(bin).mtimeMs < statSync(src).mtimeMs) {
    mkdirSync(dirname(bin), { recursive: true });
    execFileSync('swiftc', ['-O', src, '-o', bin], { stdio: 'inherit' });
  }
  return bin;
}

/** The Apple Vision face helper. */
export const faceBin = () => swiftBin('face');

/**
 * The file to take a clip's picture from. iPhones film in HDR (HLG), and
 * TikTok and Instagram show HDR uploads washed out or glaring, so an HDR clip
 * is converted to standard colour (BT.709) first (rule 44). Apple's own
 * conversion (sdr.swift) is used because it matches what the phone shows;
 * ffmpeg's tone maps turn skin pink. The copy is ProRes, about 2 GB for 2
 * minutes, kept in `dir` until the final build. An SDR clip, or any clip with
 * hdrToSdr off in config.json, is used as it is.
 */
export function pictureFile(file, dir) {
  if (!CONFIG.hdrToSdr || !probe(file).hdr) return file;
  const out = join(dir, basename(file).replace(/\.\w+$/, '.mov'));
  if (!existsSync(out) || statSync(out).mtimeMs < statSync(file).mtimeMs) {
    mkdirSync(dir, { recursive: true });
    const part = out.replace(/\.mov$/, '.part.mov');
    execFileSync(swiftBin('sdr'), [file, part], { stdio: 'inherit' });
    renameSync(part, out);
  }
  return out;
}

export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** The value p of the way up (0.9: nine in ten are at or below it). */
export const quantile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

/**
 * The plan for one video: <work>/plans/<slug>.md. The cut list is the first
 * ```json block in it, so the readable plan and what gets built can never
 * drift apart.
 */
export function readPlan(slug) {
  const p = join(WORK, 'plans', `${slug}.md`);
  const md = readFileSync(p, 'utf8');
  const m = md.match(/```json\n([\s\S]*?)\n```/);
  if (!m) throw new Error(`${p} has no json cut list`);
  return JSON.parse(m[1]);
}
