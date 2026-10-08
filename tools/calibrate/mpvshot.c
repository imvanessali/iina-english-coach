// Render a paused frame of a gray test video with an SRT through IINA's libmpv,
// saving mpv's own subtitle rendering via "screenshot-to-file ... subtitles".
// usage: mpvshot out.png subs.srt [opt=value ...]
#include <mpv/client.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
int main(int argc, char **argv) {
  mpv_handle *h = mpv_create();
  mpv_set_option_string(h, "config", "no");
  mpv_set_option_string(h, "vo", "null");
  mpv_set_option_string(h, "pause", "yes");
  
  mpv_set_option_string(h, "audio", "no");
  mpv_set_option_string(h, "screenshot-format", "png");
  mpv_set_option_string(h, "sub-files", argv[2]);
  mpv_set_option_string(h, "sub-auto", "no");
  for (int i = 3; i < argc; i++) {
    char *eq = strchr(argv[i], '='); if (!eq) continue; *eq = 0;
    if (mpv_set_option_string(h, argv[i], eq + 1) < 0) fprintf(stderr, "bad option %s\n", argv[i]);
  }
  if (mpv_initialize(h) < 0) { fprintf(stderr, "init failed\n"); return 1; }
  char url[256]; const char *size = getenv("VSIZE") ? getenv("VSIZE") : "1920x960";
  snprintf(url, sizeof url, "av://lavfi:color=c=0x404040:s=%s:d=5:r=24", size);
  const char *load[] = {"loadfile", url, NULL};
  mpv_command(h, load);
  int done = 0;
  while (!done) {
    mpv_event *e = mpv_wait_event(h, 10);
    if (e->event_id == MPV_EVENT_PLAYBACK_RESTART) {
      const char *shot[] = {"screenshot-to-file", argv[1], "subtitles", NULL};
      int r = mpv_command(h, shot);
      if (r < 0) fprintf(stderr, "screenshot failed: %s\n", mpv_error_string(r));
      done = 1;
    }
    if (e->event_id == MPV_EVENT_SHUTDOWN || e->event_id == MPV_EVENT_END_FILE || e->event_id == MPV_EVENT_NONE) { fprintf(stderr, "no frame\n"); done = 1; }
  }
  mpv_terminate_destroy(h);
  return 0;
}
