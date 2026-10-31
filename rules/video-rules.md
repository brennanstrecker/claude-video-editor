# Video rule book

These are the rules Claude follows when it edits your talking-head videos.
Every rule has a number, so you can switch it off or change it.

**Your profile comes first.** `profile/my-profile.md` says who you are, who
you make videos for and how you like them. Whatever it says wins over this
book. Its last two sections, "Rules I don't follow" and "Rules I changed",
switch rules off or rewrite them by number.

**Rules the scripts enforce have a switch in `config.json`**, shown below as
`[config: key]`. When you switch one of those rules off in your profile,
Claude also sets its switch in config.json, so the build really changes.

**The book grows with you.** Every note you give on an edit becomes a
numbered lesson at the end (from 101 on), and any rule the lesson changes is
rewritten, so the same note never has to be given twice.

## The goal

1. **Organic, not fancy** (unless your profile asks for polished). The
   rawness and honesty of what you say is what people stay for. If an edit
   makes the video look produced, it is the wrong edit.
2. **Nobody gets a reason to swipe away.** No dead air, no slow start, no
   repeated lines, no drifting off topic.

## Before anything is built

3. **A plan comes first, every time.** Nothing is rendered until you have
   seen the plan and picked the headline and the ending. The plan holds:
   - the theme (rule 5) and the video type (rule 38);
   - the transcript, with every cut marked and the reason for each;
   - where each clip hands over to the next (rules 19 to 22);
   - the length before and after cutting;
   - every proposed overlay or image, with when, why and where it comes from;
   - every proposed note on screen (rule 33);
   - three to five headline options (rule 24), each with the hook it uses;
   - the ending options (rule 34);
   - anything flagged by the truth check (rules 40 to 43);
   - the json cut list the build reads.
4. **Your answer is the build order.** Whatever you change in the plan wins
   over these rules for that video. If it is a change you would want every
   time, it becomes a lesson.

## Theme

5. **Every video gets a theme before any cut:** one sentence on what it is
   about, plus the one thing a viewer should leave with. Everything else is
   judged against it:
   - a tangent that leaves the theme is proposed for cutting;
   - the headline and ending come from it;
   - overlays and notes appear only where they serve it.

## Takes: the good one and the bad one

6. **When a line is said twice, keep the last complete version.** People
   restart once they have had a second to think, and the second attempt is
   usually the better one. A restart is the same opening words said again
   within about 20 seconds, or a sentence dropped halfway and said again
   ("So the reason I... so the main reason I started": keep the second).
   A repeat that only one transcription model hears is a real take until the
   sound proves otherwise: fast speech is easy for a transcript to miss.
7. **An unfinished sentence goes**, unless it is the only version and the
   video needs it, in which case the plan asks.
8. **A spoken self-reject removes itself and the line before it.** Markers
   include "no wait", "let me start again", "hold on", "one more time", a
   swear followed by a restart, and a sigh followed by a restart.
9. **If the last attempt is the weaker one** (it trails off, stumbles, or is
   mumbled while you were doing something else), the plan says so and picks
   the best complete one. You can overrule.
10. **Never stitch two takes into one sentence.** A sentence is kept whole
    from one take, because a stitched sentence sounds fake.
11. **Words are never rewritten.** Your own phrasing stays, including "like"
    and "you know", because that is what makes it sound like you. Only
    fillers are cut (rule 14).

## Cuts and pace

12. **The video starts on your first word, and it is heard whole.** No
    breath, no reaching for the phone. The first word lands within 0.3
    seconds, after about 0.12 seconds of room tone, because a cut right on
    the word clips its soft start ("m", "s", "h"). `[config: leadIn]`
13. **Every pause over 0.25 seconds is cut down to about 0.12 seconds.**
    Cuts sit in the gaps between words, never inside a word. The gaps come
    from the real audio, not the transcript, because Whisper stretches words
    over pauses. A soft word start below the silence level is kept: when the
    voice detector hears the voice start up to 0.15 seconds before the
    silence ends, the cut moves back to it. `[config: pauses]`
14. **"Um", "uh" and "erm" are cut.** "So", "like" and "you know" stay,
    unless they are a stall before a line (for example "So yeah," before a
    call to action, or "Okay," before "number one"), in which case the plan
    shows the cut. `[config: fillers]`
15. **Hard cuts only**, with a 30 ms audio fade at each so nothing pops. No
    transitions, no zoom punch-ins, no speed ramps, no sound effects.
16. **It ends on the last good word plus about 0.3 seconds of silence,**
    never running into the next word. No dead air and no outro.
    `[config: tail]`
17. **The recommended cut is always the tight one, whatever the raw
    length.** Beyond restarts and pauses it also takes out:
    - an idea said twice in different words (keep the fuller one);
    - the weakest of a run of near-identical lines;
    - asides about the account rather than to the viewer ("the main goal
      right now is to gain exposure");
    - a feature or example the theme doesn't need once it is made.

    The plan lists each of these cuts with the range to bring it back. If
    the video is still longer than your profile's target (75 seconds if it
    gives none), the plan proposes what else to drop or how to split it into
    parts. You decide.
18. **Nothing is kept that has no word in it.** Breaths, lip noises, clicks,
    pets and other sounds left in long pauses are dropped when the voice
    detector (Silero VAD) finds no voice in them. A piece with a voice but no
    word is kept, because it is usually part of a word the transcript timed
    elsewhere, and the check lists it to look at. A false start the
    transcript never wrote down ("it'll, and then") is cut in the plan once
    the join is re-heard (`edit/listen.mjs hear`). `[config: dropWordless]`

## Clips in one group

19. **One folder is one video.** Clips play in recording order: file
    creation time first, then file name.
20. **Each clip starts at its first word.** The lead-in before you speak is
    cut.
21. **The hand-off point.** When the next clip opens with the same words
    this clip ended on, you restarted the line in a fresh take. This clip
    ends just before that line began, and the next clip's version is used
    (unless it is the weaker take, rule 9).
22. **When there is no repeat**, the clip ends at its last complete sentence
    that is not a self-reject, a trailing "so..." or "anyway", or a mumble.
    The rest of the clip is cut, however long it is. A clip that adds nothing
    is dropped, and the plan says so.

## Headline (the hook)

23. **The headline is on screen from the very first frame.** It is catchy;
    short (seven words or fewer, two lines at most); genuine (the video pays
    it off, with no fake stakes); thought-provoking; and intriguing.
    `[config: headline.on]`
24. **Each option names the hook it uses:** a confession, stakes or a
    deadline, a contradiction, an open loop the video closes, a specific
    number, or a direct line to the viewer. The folder name is always one of
    the options.
25. **Written the way your profile says** (default: capitals, like a folder
    name, with no em dashes, exclamation marks or emojis).
26. **As big as it can be, sized by a rule, not by eye.** The longest line
    fills 80% of the frame width, and its capitals are 6% to 8% of the frame
    width tall. A headline that can't reach 6% at 80% width is too long: it
    gets reworded or split, never shrunk. When the first scene's captions
    sit just under the headline (rule 31), its size is also capped so its
    lines end above them, with a small gap. `[config: headline.fill, capMin,
    capMax]`
27. **Top centre, below the apps' top bars.** The capitals start about 14.5%
    down the frame, inside the 3:4 crop the profile grids show (they drop
    the top 12.5%). How long it stays depends on the video type (your
    profile can change this):
    - **Desk talking head:** the whole video, or the first scene only when
      you sit close to the camera (rule 31).
    - **Talking while walking:** the whole video.
    - **Day in the life:** the first scene only, at least 3 seconds.
    - **Whenever a screen shows** (a monitor, an app screen or recording
      laid on top) or a note takes its place, the headline steps aside and
      comes back after. `[config: headline.y]`

## Text style

28. **Plain text, like basic CapCut text** (unless your profile says
    otherwise): TikTok Sans bold, white. No boxes, colours, word highlights,
    emojis or animations. `[config: font]`
29. **A dark border only when white would disappear.** The background behind
    each piece of text is measured; on a light wall or a screenshot, the
    text gets a black outline.

## Captions

30. **Every spoken word is captioned**, because most people watch on mute.
    `[config: captions.on]`
    - **Position:** centred, with the top of the caption just below the
      chin. The chin comes from face detection: per clip at a desk (where it
      sits nine times in ten, since people settle lower as they talk), per
      cut when walking.
    - **Never:** on the face, or lower than 78% down the frame, where the
      apps' own text and buttons sit. `[config: captions.safeBottom]`
    - **When no face is found** (a screen recording), the last position holds.
31. **When you sit close, the captions go above your head.** If the chin
    leaves no room above the apps' text area, that clip's captions sit at the
    top, about 14% down (`captionTop` in the plan). The headline then shows
    on the first scene only, so the two never meet. Captions under the
    headline sit just below it, on the wall or the top of the hair, never on
    the face. Screens laid on top start below the captions.
32. **One line, one to four words, timed to the word, in normal case** (so
    the headline stands apart). One more word is allowed when it finishes a
    sentence. A caption breaks at the end of a sentence and never ends on a
    little word like "my" or "the". Names are spelled from your word list.
    When a kept range starts inside a pause, its captions start from the
    beginning of that pause, because the transcript often times the first
    word early, inside the pause, and the caption would lose it (the plan's
    `capFrom` overrides this).
    Swearing that stays in the audio is captioned with asterisks, and the
    plan flags it. `[config: captions.maxWords, maxChars, censor]`

## Notes on screen

33. **Clarify, don't cut.** A note is a short line of text on screen. It has
    two uses:
    - a line that overclaims or could be misread stays in, with a note that
      says what you meant (rule 40, choice A);
    - where you explain your product loosely, a note gives a sharp,
      intriguing one-line description of what it does.

    Each note is a decision in the plan: the line, the note's wording, and
    keep with a note or cut. Every note is true today. Two lines at most,
    about twelve words, normal case. It is plain white text like the captions,
    bigger than a caption and smaller than the headline, with no box or
    animation. It sits in the headline's place (the headline steps aside), or
    just under the captions when they are at the top. It shows from the
    first word of the line it explains to the last, at least 2.5 seconds.
    `[config: notes]`

## Ending

34. **The plan always offers ending options:** none (the default when you end
    on a strong line), "Link in bio", "Comment X" (one keyword that fits the
    theme), "Follow for part 2" (when the video is split), or your spoken ask
    as it is. One ask per video, and your profile's call to action first.
35. **The ending text shows over your last line**, in the headline position
    and style, for about the last 2.5 seconds. It adds no time. If you say
    the ask out loud, the text matches what you say.

## Overlays: screens and images

36. **Intentional, never decoration.** An overlay appears only while you are
    talking about the thing it shows.
    - **How often:** at most one every 15 seconds, for 1.5 to 3 seconds each,
      with a hard cut in and out.
    - **Never:** in the first 2 seconds (the hook frame is you and the
      headline), or over the captions.
    - **A screenshot** sits in the upper part of the frame and may cover your
      face for its few seconds: a desktop screen at 94% of the frame width, a
      tall phone screen up to 80%. A thin dark edge keeps a light screen from
      melting into a light wall.
    - **A screen recording** may fill the whole frame while your voice and
      the captions carry on.
37. **Where overlays come from:**
    - **Product screens:** from a demo or sample account, never real
      customer data. Your profile can limit which screens are ready to show.
    - **Your own screen recordings, or a screen you film:** every frame is
      checked first for private information (names, emails, messages, client
      or customer data, a folder or file name that identifies something
      private, anything your profile marks sensitive). The part of the screen
      that fails is blurred for the seconds it shows (`blurs` in the plan),
      or the frame is cropped or not used. `[config: blur]`
    - **Web images:** only when they help (a headline you react to, a place,
      a logo you name), with a free licence or as a screenshot of a public
      page you are commenting on. Never a photo of a private person.
      Downloaded only after you approve the plan.

## Video types

38. **Every video is one of your content types**, and the plan says which.
    Your profile lists your types; these are the defaults:
    - **Desk talking head:** static camera; the tightest cuts; where overlays
      fit most naturally.
    - **Talking while walking:** the caption position is measured at every
      cut; shaky starts and ends are cut; wind and traffic are levelled,
      never scrubbed out; overlays are rare.
    - **Day in the life:** many short clips in time-of-day order; shots
      without speech run 1 to 3 seconds; the talking parts carry the story; a
      short label ("7am") only if the plan proposes it.
    - **Screen recording with voice:** the screen fills the frame; the
      headline steps aside; captions stay.
39. **No music is added in the edit** (unless your profile asks for it). A
    sound added in TikTok or Instagram when you post is licensed there and
    links your video to that sound's page. Keep it at about 10 to 15% volume
    under a talking video.

## Truth and safety

40. **Every claim about your product is checked against what is true
    today**, using your profile's "Claims I must never make" and "What is
    true today". A flagged line is never removed silently; it is a decision
    for you:
    - **A. Keep it with a note on screen** that says what you meant (rule
      33). This is the default when cutting the line would break the flow.
    - **B. Cut it.**
41. **Anything your profile marks as needing approval** (an employer, a
    school, a client, a partner) goes to whoever must approve it before you
    post, and its name stays off screen until they do.
42. **On-screen words follow your profile's "Words I use" and "Words I never
    use"** (default: no em dashes or exclamation marks).
43. **No other person's face, name or work** without their OK.

## Made for TikTok and Instagram

44. **One clean file for both apps.**
    - **Standard colour:** iPhones film in HDR, and both apps show HDR
      uploads washed out or glaring. Every HDR clip is converted to standard
      colour (SDR, BT.709) with Apple's own conversion, which matches what
      the phone shows, and the file is tagged that way. `[config: hdrToSdr]`
    - **The file:** 1080x1920, 30 fps, H.264, AAC at 192 kbps, -14 LUFS.
      Both apps re-encode every upload, so a clean file is all that helps;
      4K or 60 fps would not. `[config: frame, loudness]`
    - **When you post:** on TikTok, turn on More options, "Allow high-quality
      uploads", for every post. On Instagram, turn on Settings, Data usage,
      "Upload at highest quality", once. Keep the post description to a line
      or two, or it climbs over the captions.
45. **Sent to your phone only when you ask.** `node edit/send.mjs <words
    from the name>` opens AirDrop with the exact file; click your iPhone and
    it lands in Photos. With `--icloud` it goes to iCloud Drive for when you
    are away from the Mac. Never by email: Gmail stops at 25 MB.
46. **Every video sent to your phone comes with its post caption.** Two or
    three options, the recommended one first, ready to paste, saved in the
    plan under "Post caption".
    - **Line 1 is the hook**, under about 60 characters, because it is all
      that shows before "more": an easy question to answer in a comment, a
      specific claim, or a line from the video.
    - **Line 2 says what the video or your product is, in the words your
      audience searches** (your profile lists them), written as a sentence,
      never a keyword list. Both apps read the caption, the spoken words and
      the on-screen text together.
    - **One ask**, matching the video's own. Never two.
    - **Three hashtags at the end:** topic, audience, series. Never more than
      five.
    - **About 150 characters** before the hashtags, with the same truth and
      word rules as the video.
    - **Learning what works:** when you say "posted", the date, app and
      caption go in the plan; after 48 hours, your views, comments and link
      clicks or signups. The caption shape that brings the best results
      becomes the default.

## Output and checks

- **Format:** 1080x1920 at 30 fps, H.264 with AAC, standard colour.
- **Audio:** your own audio, levelled to -14 LUFS, with no music.
- **Where it goes:** `<Ready folder>/<HEADLINE>.mp4`, plus a cover frame.
- **Checked before you see it** (`node edit/check.mjs <slug>`):
  - every cut boundary has no clipped word and no pop;
  - no leftover retake, breath, click or false start;
  - the captions match the finished sound: the video is transcribed again,
    whole and in short chunks, and compared word by word;
  - the picture runs exactly the plan's length, so captions don't drift;
  - standard colour;
  - the first word lands within 0.3 s, after some room tone;
  - the headline is on frame 1;
  - captions never cover the face, the headline or the apps' text;
  - the length is reported.

## Lessons from your reviews

Every edit you ask for is fixed, then written here as a numbered rule (from
101) with the date and the video it came from. If it changes a rule above,
that rule is rewritten too, so no two rules disagree.

(none yet)
