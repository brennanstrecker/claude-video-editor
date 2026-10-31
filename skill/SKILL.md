---
name: video-edit
description: Edit the user's talking-head videos for TikTok and Instagram from raw clips into finished vertical videos, following their own profile and a rule book that learns from their notes. Use when they say "edit my videos", "edit <folder name>", name a folder in their raw videos folder, give notes on a video Claude edited, ask for a video on their phone ("send it", "AirDrop it"), ask for a post caption, say they posted one, or want to set up or change their editing profile.
---

# Video editing

## Where everything is

This skill's folder is a link to the `skill/` folder of the video editor
repo. The repo is the folder above it:

```bash
REPO="$(cd "$(dirname "$(realpath ~/.claude/skills/video-edit/SKILL.md)")/.." && pwd)"
```

If that path has no `edit/` folder (the skill was copied, not linked), ask the
user where they put the repo and use that.

- `profile/my-profile.md`: the user's strategy, content types and style. It
  wins over the rule book.
- `rules/video-rules.md`: the numbered rules, with the user's own lessons at
  the end.
- `config.json`: the folders, and a switch or number for every rule the
  scripts enforce.
- `edit/`: the scripts. Run them from the repo folder.
- The work folder (`workFolder` in config.json) holds `plans/<slug>.md`, one
  plan per video, and `edits/<slug>/` with the scan data and test renders.

## Step 0: the profile, before anything else

Read `profile/my-profile.md` first, every time.

**If its `status` is `template`, or any section still says `<!-- fill in
-->`, stop.** Don't scan or edit anything. Ask the user to paste:
- their content strategy and goal;
- their content types, and how the headline should behave in each;
- who they are, what they sell or build, and who it is for;
- their style, words they use and never use, and the names to transcribe;
- what is true about their product and what they must never claim;
- anything that needs approval before posting;
- their call to action and link, screens they can show, platforms and
  schedule, post caption style, music, best videos;
- any rules they don't want, or want changed.

Say they can paste whatever they already have, in any shape, and you will
sort it into the profile. Then:
1. Fill every section in their own words. Ask only about what is missing.
2. Show them the profile and fix what they correct.
3. Set `status: filled`.
4. Put section 7's names into `config.json` (`whisper.wordList` as one or
   two short sentences, and `spelling` for the fixes).
5. For every rule in "Rules I don't follow" or "Rules I changed" that has a
   `[config: ...]` switch, set the switch in `config.json` and tell them
   what changed.
6. Check the folders in `config.json` exist, and create them if they don't.

When they later say something that belongs in the profile ("I've started
doing walking videos", "never say cheap"), update the profile the same way.

## Every time, before a plan

Read the profile, then the rule book. Apply "Rules I don't follow" (skip
those rules) and "Rules I changed" (use their version). Where the profile and
a rule disagree, the profile wins.

## Steps

1. **Scan** (from the repo folder): `node edit/scan.mjs "<folder in the raw
   folder>"`. It writes the transcript pack to `<work>/edits/<slug>/pack.txt`.
   The first run of a Whisper model downloads it.
2. **Write the plan** to `<work>/plans/<slug>.md`, reading the pack against
   the profile and the rules. It holds:
   - the theme and the type;
   - the transcript, with cuts struck through and a reason for each;
   - the tightening cuts, each with the range to bring it back;
   - the hand-offs between clips;
   - the length before and after;
   - overlays and notes on screen, with why;
   - 3 to 5 headline options, each naming its hook, the folder name as one;
   - 2 to 4 ending options;
   - truth and safety flags, each as a decision: keep with a note, or cut;
   - the json cut list (below).

   Check doubtful moments before you commit to them:
   - `node edit/listen.mjs hear <clip> <from> <to>` shows what two models
     hear;
   - `node edit/listen.mjs quiet <clip> <from> <to>` finds a cut point
     inside connected speech. Only cut at a dip near room tone.
   - A repeat one model hears is a real take until proven otherwise.
3. **Test build:** `node edit/build.mjs <slug> --test`, then `node
   edit/check.mjs <slug>`.
   - Look at `check-frames.png`, `check-cuts.png` and `check-wave.png`.
   - Re-hear every join the check lists with `listen.mjs hear`.
   - Fix the plan and rebuild until the check is clean or every item is
     explained.
   - Then show the user the plan and stop. **No final render before they
     pick the headline and the ending.**
4. **After their answer:**
   - put their picks in the json;
   - `node edit/build.mjs <slug>` (the output goes to the Ready folder);
   - `node edit/check.mjs <slug>`, and fix any problem;
   - give them the file.
5. **Their notes:**
   - fix them, rebuild, re-check;
   - add each note as a numbered lesson (from 101) at the end of
     `rules/video-rules.md`, with the date and the video;
   - rewrite any older rule the lesson contradicts, so no two rules
     disagree;
   - if the note is a preference about them rather than about editing,
     update the profile instead.
6. **Send to their phone, only when they ask** (rule 45):
   - `node edit/send.mjs <words from the name>` (no words: the newest video;
     several names: several videos);
   - tell them to click their iPhone in the AirDrop window;
   - if AirDrop fails or they are away from the Mac, use `--icloud`;
   - never email it;
   - when it lands, remind them of the upload settings in rule 44.
7. **Post captions, right after the send** (rule 46):
   - for each video, 2 or 3 captions, recommended first, each naming its
     hook and its one ask;
   - save them under "Post caption" in the plan;
   - when they say "posted", log the date, app and caption there;
   - after 48 hours, log their views and results, so the caption shape that
     works becomes the default.

## The json cut list

The first ```json block in the plan. Times are seconds in the raw clip.

```json
{
  "group": "My first video",
  "type": "desk",
  "headline": { "text": "I QUIT MY JOB.\nHERE'S WHY.", "show": "whole" },
  "ending": null,
  "captionTop": { "IMG_1234": 0.14 },
  "keep": [
    { "clip": "IMG_1234", "from": 0.8, "to": 15.2, "why": "opening to 'quit my job'" },
    { "clip": "IMG_1234", "from": 41.7, "to": 49.7, "capFrom": 41.8, "capTo": 49.5, "why": "'so here's why' to the end" }
  ],
  "notes": [
    { "clip": "IMG_1234", "from": 22.0, "to": 26.5, "text": "What it means,\nin two short lines." }
  ],
  "overlays": [
    { "file": "shots/app-home.png", "clip": "IMG_1234", "at": 42.7, "dur": 2.0, "mode": "card", "top": 0.21 }
  ],
  "screens": [ { "clip": "IMG_1235", "from": 0.5, "to": 38.0 } ],
  "captionFixes": { "going to": "gonna" },
  "file": "optional output name"
}
```

- `type`: `desk`, `walking`, `day` or the user's own type names.
- `headline.show`:
  - `whole` (the default);
  - `first-scene` (the first clip only, at least 3 s);
  - a number of seconds.
- `ending`: `null`, or `{ "text": "LINK IN BIO", "seconds": 2.5 }`.
- `captionTop`: only for clips where the face sits so low the captions go
  above the head (rule 31).
- `keep`:
  - `from` and `to` sit in silence, or at a checked dip;
  - `capFrom` and `capTo` set which transcript words get captioned when
    Whisper's times drift past the cut.
- `notes`: on-screen notes (rule 33). Two lines at most, broken with `\n`.
- `overlays`:
  - `file` is absolute, or relative to the work folder;
  - `mode` is `card` (a screenshot in the upper frame) or `full` (fills the
    frame);
  - `top` moves a card down.
- `screens`: ranges where the clip itself shows a screen, so the headline
  steps aside.
- `captionFixes`: what the captions show instead of what Whisper wrote, so
  they match what was said. `"QR~codes"` keeps two words in one caption.

## Always

- Keep the last complete take. Cut self-rejects, unfinished sentences, and
  sounds with no words.
- End each clip at the hand-off, where the next clip restarts the line.
- Check every claim against the profile, and every screen frame for private
  information.
- Raw footage and renders never go into git.
