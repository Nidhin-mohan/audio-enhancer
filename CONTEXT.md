# Audio Enhancer

A personal, single-user browser app for cleaning up and improving music recorded on a phone. All processing happens on the user's own computer; no third-party services.

## Language

**Recording**:
The single audio file the user imports to work on: typically a noisy music take captured on a phone. One Recording is worked on at a time.
_Avoid_: track (ambiguous with Stem), clip, upload

**Stem**:
One isolated part of a Recording produced by Separation. There are four: **vocals**, **drums**, **bass**, **other** (everything else, including most background noise).
_Avoid_: track, layer, channel

**Separation**:
Splitting a Recording into its four Stems.
_Avoid_: splitting tracks, demixing

**Noise Reduction**:
Removing unwanted background sound (hiss, hum, room noise) while keeping the music. Has an adjustable amount, so some natural room sound can be kept.
_Avoid_: cleanup (too broad), enhancement

**Vocal Boost**:
Raising the vocals Stem to a natural level against the music, because phone Recordings often capture the voice too quietly. Applied automatically by default and adjustable by hand.
_Avoid_: increasing the noise, gain, volume up

**Pitch Correction**:
Nudging off-key sung notes on the vocals Stem toward the correct notes of the song's key. Commonly called auto-tune.
_Avoid_: auto-tune (fine in conversation, but not as the term), tuning

**Key**:
The musical key and scale (e.g. A minor) that Pitch Correction snaps notes to. Detected automatically from the Recording; the user can override it.

**Pitch Correction Preset**:
A named set of Pitch Correction settings. Three built-in ones, so the user doesn't have to adjust anything: **Natural** (gentle, barely audible), **Tight** (clearly in tune, still human), **Hard** (the deliberate robotic effect). Adjusting any setting yields an unsaved **Custom** state, which the user can save as their own named Preset. The setting that blends corrected and original voice is called **Blend** (not "mix", which means the Mix).

**Pitch picture**:
A graph in the Pitch Correction section of the notes as sung and as corrected, drawn over the notes of the Key, so the user can see what Pitch Correction is doing with the current settings.
_Avoid_: profile, mode

**Trim**:
The start and end points of the Recording that are kept; everything outside is left out of the Mixdown. Set by dragging directly on the Recording's waveform.
_Avoid_: cut, crop

**Fade**:
A gradual rise from silence at the start of the Trim (fade in) or fall to silence at its end (fade out). Set by dragging handles on the Recording's waveform.

**Mix**:
Every choice the user makes that decides how the Mixdown sounds: the Trim and Fades, the balance of Stems (level, mute, solo per Stem), the Noise Reduction, Vocal Boost and Pitch Correction settings (including the Key), and the Mixdown's format and loudness. Every change to the Mix can be undone.
_Avoid_: preset, project

**Listening volume**:
How loud the user hears playback while working. Not part of the Mix; it never changes the Mixdown.
_Avoid_: master volume

**Mixdown**:
The single enhanced audio file produced from a Mix, levelled to a standard loudness and ready to share on any platform. ("Enhanced" here means the whole result, as in the app's name, not Noise Reduction alone.)
_Avoid_: output, master, render, bounce

## Flagged ambiguities

- "Increase the noise" was used to mean making the voice louder. Resolved: that is **Vocal Boost**, not anything to do with noise.
