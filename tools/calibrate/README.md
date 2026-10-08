# Alignment calibration

Checks that the paused, selectable subtitle lands exactly on top of IINA's own
subtitle. It renders one frame with IINA's bundled libmpv (mpv 0.38, libass 0.17)
and the overlay page in an offscreen WebKit view at the same size, then compares
the white glyph pixels. No IINA window or screen access is needed.

```bash
tools/calibrate/build.sh
node tools/calibrate/run.js '{}' base
node tools/calibrate/run.js '{"fontSize":75,"font":"Avenir"}' avenir75
node tools/calibrate/run.js '{"position":85}' pos "A long line that libass has to wrap onto two or three lines on screen."
```

The style JSON uses the plugin's style fields (`fontSize`, `scale`, `font`, `bold`,
`italic`, `outlineSize`, `shadowOffset`, `marginX`, `marginY`, `position`,
`spacing`, `alignX`, `alignY`, `backColor`, `borderStyle`). A good result is
`dx` within ±1 and `dy` 0 device pixels. Images are written to `tools/calibrate/out/`.
