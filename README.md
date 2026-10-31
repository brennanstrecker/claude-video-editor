# Claude video editor

A Claude Code skill that edits talking-head videos for TikTok and Instagram.
You drop your raw phone clips in a folder and ask Claude to edit them. It:

- finds the best take of each line and cuts the pauses, fillers, restarts
  and breaths;
- writes a plan with headline and ending options, for you to approve;
- adds a headline and captions placed under your chin (or above your head if
  you sit close), and notes on screen where a line needs clarifying;
- converts iPhone HDR to standard colour and levels the sound;
- checks its own work by transcribing the result again;
- AirDrops the finished video to your phone, and suggests post captions.

It follows your own strategy and style. The first time you use it, it asks
you to paste your content strategy and the kinds of video you make, and it
keeps them in a profile. Every rule can be switched off or changed, and every
note you give becomes a new rule, so it gets closer to how you like your
videos with each edit.

## Before you start

- **A Mac.** Face detection (Apple Vision), the HDR conversion (AVFoundation)
  and AirDrop use Apple's own tools, so this does not run on Windows or
  Linux.
- **Claude Code**, which needs a paid Claude plan.
- **Talking-head videos.** It is built for one person talking to the camera
  at a desk, walking or through the day. It is not a general video editor.
- **English by default.** The Whisper models in `config.json` are the
  English ones (`small.en`, `base.en`). For other languages, set them to
  `small` and `base`.
- About 1 GB of disk for the speech models, and room for working files
  (an iPhone HDR clip's standard-colour copy is about 1 GB a minute until the
  final build).

## Install

```bash
git clone <this repo> ~/claude-video-editor
cd ~/claude-video-editor
./setup.sh
```

`setup.sh` checks for Node 18 or newer, Python 3 and Apple's Swift compiler.
If the compiler is missing it asks you to run `xcode-select --install`.
It then installs three Python packages (faster-whisper, imageio-ffmpeg and
fonttools) and links the skill into `~/.claude/skills/video-edit`.

## First run

1. Open `config.json` and set the three folders:
   - `rawFolder`: where you put one folder of clips per video;
   - `readyFolder`: where finished videos go;
   - `workFolder`: plans and working files.

   The defaults are `Raw content/Videos`, `Ready` and `Work` on your
   Desktop. `setup.sh` creates them.
2. Start Claude Code anywhere and say "set up my video profile". Paste your
   content strategy, the types of video you make and anything you know about
   your style. Claude fills in `profile/my-profile.md` with you, and won't
   edit anything until it is done.

## Making a video

1. Film your clips and put them in a new folder inside the raw folder, named
   like the video ("I quit my job").
2. Tell Claude: "edit I quit my job".
3. Claude scans the clips, writes the plan and test-renders it. Read the
   plan, pick a headline and an ending, and say what to change.
4. Claude builds the final video into the Ready folder and checks it.
5. Give notes if anything is off. Each one becomes a rule for next time.
6. Say "send it" and it opens AirDrop; click your iPhone. Claude then
   suggests post captions.

## Make it yours

- **Your profile** (`profile/my-profile.md`) wins over everything else: your
  audience, content types, words, claims to avoid, call to action.
- **Rules** (`rules/video-rules.md`) are numbered. List any you don't want
  under "Rules I don't follow" in your profile, or rewrite them under "Rules
  I changed".
- **Settings** (`config.json`) are the numbers and switches the scripts use:
  - pause length, fillers, the lead-in before the first word, the tail;
  - headline and caption size, captions on or off, notes on or off;
  - loudness, HDR conversion, the font.

  When you switch a rule off in your profile, Claude flips the matching
  setting for you.
- **Lessons:** every note you give is added to the rule book from rule 101
  on, and any rule it contradicts is rewritten.

## What's inside

| Path | What it is |
|---|---|
| `skill/SKILL.md` | What Claude does, step by step |
| `profile/my-profile.md` | Your strategy, style and rule choices |
| `rules/video-rules.md` | The numbered editing rules and your lessons |
| `config.json` | Folders, switches and numbers |
| `edit/scan.mjs` | Transcribes clips, finds silences and the face |
| `edit/build.mjs` | Builds the video from the plan |
| `edit/check.mjs` | Checks the built video |
| `edit/listen.mjs` | Hears one moment, to settle doubtful cuts |
| `edit/send.mjs` | AirDrop or iCloud to your iPhone |
| `edit/*.swift`, `edit/*.py` | The face, colour, AirDrop, transcription and voice helpers |

Raw footage and renders never go into the repo: they stay in your own
folders.

## Credits

- Speech to text: [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
  (MIT), using OpenAI's Whisper models.
- Voice detection: [Silero VAD](https://github.com/snakers4/silero-vad) (MIT),
  included with faster-whisper.
- Video: ffmpeg, through [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg).
- Font: [TikTok Sans](https://github.com/tiktok/TikTokSans), SIL Open Font
  License 1.1 (`edit/fonts/OFL.txt`).

Made by Brennan Strecker. MIT licence (`LICENSE`).
