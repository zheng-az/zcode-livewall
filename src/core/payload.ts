/**
 * Builds the injected video-wallpaper payload and the bootstrap script that
 * installs it into the ZCode renderer.
 *
 * The layer is a fixed, pointer-events:none <video> behind the app, with an
 * optional blurred copy behind it for `contain`, a dim overlay, and a poster
 * image so the window is never blank while the video buffers.
 *
 * Everything is rebuilt idempotently: the bootstrap can run again on every
 * config change and on every renderer reload without stacking elements.
 */

import { buildVariableOverrides, buildTransparencyOverrides, buildFrostOverrides } from "./tokens.js";
import type { LiveWallConfig } from "./config.js";
import type { Theme } from "@material/material-color-utilities";

export const MARKER = "zcode-livewall";

export interface PayloadInput {
  config: LiveWallConfig;
  /** Loopback URL of the video (or animated GIF), or undefined for a still. */
  videoUrl?: string;
  /** Loopback URL of the poster/still image. */
  posterUrl?: string;
  theme?: Theme;
  /** `web` projects are an HTML page, not a video element. */
  webUrl?: string;
}

export interface BuiltPayload {
  css: string;
  script: string;
}

function layerCss(config: LiveWallConfig): string {
  // A blur samples transparent pixels near the edge and the result looks like
  // a faded frame, so the layer is grown slightly to hide that seam. In
  // contain mode the scale must stay at 1: growing the layer pushes the
  // letterbox bars off-screen and the whole wallpaper reads as an upscaled blur.
  const blurScale =
    config.blur > 0 && config.fit !== "contain" ? 1 + Math.min(0.08, config.blur / 500) : 1;
  return `
html, body { background: transparent !important; }
#${MARKER}-stage {
  position: fixed;
  inset: 0;
  z-index: -2147483646;
  overflow: hidden;
  pointer-events: none;
  /* Near-black with a little transparency: with the frost idle layer on top
     the window reads as a frosted pane; with a wallpaper the media covers it. */
  background: rgba(11, 11, 16, 0.82);
}
#${MARKER}-video, #${MARKER}-poster, #${MARKER}-web {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: ${config.fit};
  object-position: center;
  pointer-events: none;
  border: 0;
}
/* contain: the media is sized by the injected script, which knows
   the intrinsic dimensions and the stage size. CSS alone cannot do this well:
   object-fit only rearranges content inside a full-size box, and auto sizing
   never scales UP (a 248px GIF stays 248px in a 1150px window).
   The script sets width/height in px on the media elements. */
#${MARKER}-stage[data-fit="contain"] #${MARKER}-video,
#${MARKER}-stage[data-fit="contain"] #${MARKER}-poster {
  inset: 0;
  margin: auto;
  object-fit: contain;
}
/* Explicit stacking. The backdrop is appended after the media layers, so
   without this it paints on top of them and the whole wallpaper reads as a
   blurred smear in contain mode. */
#${MARKER}-backdrop { z-index: 0; }
#${MARKER}-video, #${MARKER}-poster, #${MARKER}-web { z-index: 1; }
#${MARKER}-dim { z-index: 2; }
#${MARKER}-video, #${MARKER}-poster, #${MARKER}-web {
  filter: blur(${config.blur}px);
  transition: opacity .25s ease, filter .25s ease;
}
#${MARKER}-video, #${MARKER}-poster {
  transform: scale(${blurScale});
  opacity: ${config.wallpaperVisible ? 1 : 0};
}
/* While the video is still buffering its first frame the poster (a real
   thumbnail of the same source) shows through underneath; once the video is
   actually drawing, the poster fades out so there is no black startup gap. */
/* While the video is still buffering its first frame the poster (a real
   thumbnail of the same source) shows through underneath; once the video is
   actually drawing, the poster fades out so there is no black startup gap.
   The [data-video] guard keeps a stale ready flag from hiding the poster on
   image wallpapers, where there is no video to take over the frame. */
#${MARKER}-stage[data-vready="1"][data-video="1"] #${MARKER}-poster { opacity: 0; }
#${MARKER}-backdrop {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  /* Dimmer than the sharp image so the letterbox bars read as ambient fill
     rather than competing with the picture in the middle. Tracks the user's
     blur (plus a floor) so slider-at-zero also clears the bars. */
  filter: blur(${config.blur + 12}px) saturate(1.1) brightness(.55);
  transform: scale(1.15);
  display: none;
}
#${MARKER}-backdrop[data-on="1"] { display: block; }
#${MARKER}-stage[data-hidden="1"] { display: none; }
#${MARKER}-dim {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / var(--zcode-livewall-dim, ${config.dim / 100}));
  pointer-events: none;
}
/* Frosted idle layer. Shown whenever nothing is painted on the stage (no
   source configured, or a video still buffering its first frame): a soft
   animated tint that reads as frosted glass behind the translucent UI. It is
   a stage layer, not a window effect — the renderer cannot blur the desktop
   behind the window, but a tinted sheet under see-through surfaces looks the
   part and costs nothing. */
#${MARKER}-frost {
  position: absolute;
  inset: 0;
  display: none;
  background:
    radial-gradient(120% 90% at 20% 10%, rgba(120,140,255,.16), transparent 60%),
    radial-gradient(110% 100% at 85% 20%, rgba(255,120,190,.12), transparent 55%),
    radial-gradient(130% 110% at 50% 95%, rgba(80,220,255,.10), transparent 60%),
    linear-gradient(160deg, rgba(255,255,255,.10), rgba(255,255,255,.03));
  animation: ${MARKER}-frost-drift 26s ease-in-out infinite alternate;
}
#${MARKER}-frost::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(115deg, transparent 30%, rgba(255,255,255,.05) 45%, transparent 60%);
  animation: ${MARKER}-frost-sheen 14s linear infinite;
}
@keyframes ${MARKER}-frost-drift {
  from { transform: scale(1.02) translate(0, 0); }
  to   { transform: scale(1.1) translate(-2.5%, 1.8%); }
}
@keyframes ${MARKER}-frost-sheen {
  from { transform: translateX(-70%); }
  to   { transform: translateX(70%); }
}
/* Show the frost only when the stage is up but has nothing real to paint:
   no active media (data-ready="0") or a video still waiting for its first
   frame (vready not yet "1"). A live wallpaper always outranks it. */
#${MARKER}-stage[data-ready="0"]:not([data-hidden="1"]) #${MARKER}-frost,
#${MARKER}-stage[data-video="1"]:not([data-vready="1"]):not([data-hidden="1"]) #${MARKER}-frost {
  display: block;
}
@media (prefers-reduced-motion: reduce) {
  #${MARKER}-frost { animation: none; }
  #${MARKER}-frost::after { display: none; }
}`;
}

export function buildPayload(input: PayloadInput): BuiltPayload {
  const { config, theme } = input;
  const parts: string[] = [layerCss(config)];

  if (theme) {
    if (config.monet) {
      parts.push(
        buildVariableOverrides(theme, {
          dim: config.dim,
          wallpaperVisible: config.wallpaperVisible,
        })
      );
    } else if (config.wallpaperVisible) {
      parts.push(buildTransparencyOverrides({ dim: config.dim }));
    }
  } else if (!input.videoUrl && !input.posterUrl && !input.webUrl) {
    // No sampled colors AND no media at all: the true idle state. Ship the
    // frosted-glass token set. A media source with its theme still pending
    // must NOT take this branch — background re-pushes (poster ready, steam
    // cover, optimize swap) go through here, and flipping every token twice
    // per re-push made the whole UI strobe on every wallpaper switch.
    parts.push(buildFrostOverrides());
  }

  const css = parts.join("\n");
  return { css, script: buildBootstrapScript(input, css) };
}

/** The script is self-contained so it can be re-evaluated on reload. */
export function buildBootstrapScript(input: PayloadInput, css: string): string {
  const { config, videoUrl, posterUrl, webUrl } = input;
  const showVideo = Boolean(videoUrl) && config.wallpaperVisible;
  const showWeb = Boolean(webUrl) && config.wallpaperVisible;
  const showPoster = Boolean(posterUrl) && config.wallpaperVisible;
  // The stage must stay up even with no media: it carries the frosted idle
  // layer shown when nothing is playing (no source, or a buffering video).
  const visible = config.wallpaperVisible;

  return `(function boot(){
  // addScriptToEvaluateOnNewDocument fires before the document has a root
  // element; appending then throws and the layer never installs.
  if (!document.documentElement) { setTimeout(boot, 30); return; }
  var MARKER = ${JSON.stringify(MARKER)};
  var STAGE = MARKER + '-stage';
  var VIDEO_URL = ${JSON.stringify(videoUrl ?? "")};
  var POSTER_URL = ${JSON.stringify(posterUrl ?? "")};
  var WEB_URL = ${JSON.stringify(webUrl ?? "")};
  var FIT = ${JSON.stringify(config.fit)};
  var SPEED = ${config.speed};
  var PAUSED = ${config.paused ? "true" : "false"};
  var PAUSE_ON_BLUR = ${config.pauseOnBlur ? "true" : "false"};
  var VISIBLE = ${visible ? "true" : "false"};
  var SHOW_VIDEO = ${showVideo ? "true" : "false"};
  var SHOW_WEB = ${showWeb ? "true" : "false"};
  var SHOW_POSTER = ${showPoster ? "true" : "false"};
  var DIM = ${config.dim / 100};
  var CSS = ${JSON.stringify(css)};

  var state = window.__zcodeLivewall || (window.__zcodeLivewall = {});
  state.config = { videoUrl: VIDEO_URL, posterUrl: POSTER_URL, webUrl: WEB_URL, fit: FIT, speed: SPEED, paused: PAUSED, pauseOnBlur: PAUSE_ON_BLUR, visible: VISIBLE };

  // --- stylesheet ----------------------------------------------------------
  var style = document.getElementById(MARKER + '-style');
  if (!style) {
    style = document.createElement('style');
    style.id = MARKER + '-style';
    (document.head || document.documentElement).appendChild(style);
  }
  if (style.textContent !== CSS) style.textContent = CSS;

  // The panel's live preview sets blur/transform inline on the media layers,
  // and inline styles beat this stylesheet forever. Every re-injection is the
  // authority: drop those properties so the shipped CSS is what renders.
  ['${MARKER}-video', '${MARKER}-poster', '${MARKER}-web'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.style.removeProperty('filter');
    el.style.removeProperty('transform');
  });
  var bd = document.getElementById('${MARKER}-backdrop');
  if (bd) bd.style.removeProperty('filter');

  // --- stage ---------------------------------------------------------------
  var stage = document.getElementById(STAGE);
  if (!stage) {
    stage = document.createElement('div');
    stage.id = STAGE;
    document.documentElement.appendChild(stage);
  }
  stage.dataset.fit = FIT;
  stage.dataset.hidden = VISIBLE ? '0' : '1';
  // Marks that a video layer is the active frame owner; the poster fade-out
  // rule keys off this so it can never hide an image wallpaper.
  stage.dataset.video = SHOW_VIDEO ? '1' : '0';
  // Ready = the stage has real pixels to paint (web page, poster image, or a
  // playing video). It gates the frosted idle layer underneath.
  stage.dataset.ready = (SHOW_WEB || SHOW_POSTER) ? '1' : '0';

  // --- frosted idle layer --------------------------------------------------
  var frost = document.getElementById(MARKER + '-frost');
  if (!frost) {
    frost = document.createElement('div');
    frost.id = MARKER + '-frost';
    stage.appendChild(frost);
  }

  // --- blurred backdrop for letterboxed framing ----------------------------
  var backdrop = document.getElementById(MARKER + '-backdrop');
  var backdropSrc = POSTER_URL || VIDEO_URL;
  var wantsBackdrop = FIT === 'contain' && backdropSrc;
  if (wantsBackdrop) {
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = MARKER + '-backdrop';
      stage.appendChild(backdrop);
    }
    if (backdrop.dataset.src !== backdropSrc) {
      backdrop.style.backgroundImage = 'url("' + backdropSrc + '")';
      backdrop.dataset.src = backdropSrc;
    }
    backdrop.dataset.on = '1';
  } else if (backdrop) {
    backdrop.dataset.on = '0';
  }

  // --- poster still --------------------------------------------------------
  var poster = document.getElementById(MARKER + '-poster');
  if (SHOW_POSTER) {
    if (!poster) {
      poster = document.createElement('img');
      poster.id = MARKER + '-poster';
      poster.alt = '';
      poster.decoding = 'async';
      stage.appendChild(poster);
    }
    if (poster.getAttribute('src') !== POSTER_URL) {
      // Intrinsic size is only known after decode, so sizing waits for load.
      // One listener per element instance: re-evaluating the boot script on a
      // live poster used to accumulate a listener every push.
      if (state.loadHooked !== poster) {
        state.loadHooked = poster;
        poster.addEventListener('load', function () {
          if (state.applyMediaSizing) state.applyMediaSizing();
        });
      }
      poster.src = POSTER_URL;
    } else if (poster.naturalWidth && poster.naturalHeight && state.applyMediaSizing) {
      state.applyMediaSizing();
    }
    // The poster stays visible under the video until the first frame draws
    // (see the vready wiring below): a black startup gap reads as a hang.
    poster.style.display = 'block';
  } else if (poster) {
    poster.style.display = 'none';
  }

  // --- video layer ---------------------------------------------------------
  // Two stacked <video> elements with a crossfade on switch. Swapping src on
  // one element blanks the frame the instant src changes, which reads as a
  // flash before the new stream decodes; playing the new one on top and only
  // removing the old after the fade keeps a continuous picture.
  var video = document.getElementById(MARKER + '-video');
  if (SHOW_VIDEO) {
    var sameStream = video && video.getAttribute('src') === VIDEO_URL;
    if (!video) {
      video = document.createElement('video');
      video.id = MARKER + '-video';
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.disablePictureInPicture = true;
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      stage.appendChild(video);
      // The poster-under-video handoff: the video element paints after the
      // poster in DOM order, so the poster shows through until this fires.
      video.addEventListener('playing', function () {
        var st = document.getElementById(STAGE);
        if (st) { st.dataset.vready = '1'; st.dataset.ready = '1'; }
      });
    }
    if (sameStream) {
      if (video.videoWidth && video.videoHeight && state.applyMediaSizing) {
        state.applyMediaSizing();
      }
    } else {
      var old = video;
      var fresh = document.createElement('video');
      fresh.id = MARKER + '-video';
      fresh.muted = true;
      fresh.loop = true;
      fresh.autoplay = true;
      fresh.playsInline = true;
      fresh.preload = 'auto';
      fresh.disablePictureInPicture = true;
      fresh.setAttribute('muted', '');
      fresh.setAttribute('playsinline', '');
      fresh.style.opacity = '0';
      fresh.style.transition = 'opacity .45s ease';
      stage.appendChild(fresh);
      fresh.addEventListener('loadedmetadata', function () {
        if (state.applyMediaSizing) state.applyMediaSizing();
      });
      fresh.addEventListener('playing', function () {
        var st = document.getElementById(STAGE);
        if (st) { st.dataset.vready = '1'; st.dataset.ready = '1'; }
        // First frame is on screen: fade the new stream in, then retire the
        // old element so only one decoder keeps running.
        fresh.style.opacity = '1';
        var victim = old;
        setTimeout(function () {
          try {
            victim.pause();
            victim.removeAttribute('src');
            victim.load();
            victim.remove();
          } catch (e) {}
        }, 500);
      });
      fresh.src = VIDEO_URL;
      fresh.load();
      var pf = fresh.play();
      if (pf && pf.catch) pf.catch(function () {});
      // Hand the element id over immediately so every lookup (syncPlayback,
      // sizing, the panel) sees the incoming stream, never two at once.
      old.removeAttribute('id');
      fresh.id = MARKER + '-video';
      video = fresh;
      var stx = document.getElementById(STAGE);
      // No poster flash: keep whatever frame the old stream shows visible by
      // marking ready already if it was ready.
      if (stx && old.videoWidth) { stx.dataset.vready = '1'; stx.dataset.ready = '1'; }
    }
    video.playbackRate = SPEED;
    video.style.display = 'block';

    if (PAUSED) {
      try { video.pause(); } catch (e) {}
    } else {
      var p = video.play();
      if (p && p.catch) p.catch(function () {});
    }

    // Autoplay can be blocked until the first user gesture; retry once.
    if (!state.gestureHooked) {
      state.gestureHooked = true;
      var retry = function () {
        var v = document.getElementById(MARKER + '-video');
        if (v && !(state.config && state.config.paused)) {
          var q = v.play(); if (q && q.catch) q.catch(function () {});
        }
      };
      document.addEventListener('pointerdown', retry, { once: true });
      document.addEventListener('keydown', retry, { once: true });
    }
  } else if (video) {
    // Keep the element: removing it here breaks the "hide wallpaper, then show
    // it again" path, because the next injection only recreates a video when
    // it is missing *and* the source is a video — but the stage still holds a
    // stale layer reference in the meantime.
    video.style.display = 'none';
    try { video.pause(); } catch (e) {}
  }

  // The ready flag belongs to video sources only. Clearing it inside the video
  // branch above missed the case where the video element had already been
  // removed: the flag then stayed on the stage and faded the poster to
  // opacity 0, leaving only the blurred backdrop visible on image wallpapers.
  if (!SHOW_VIDEO) {
    var stClear = document.getElementById(STAGE);
    if (stClear) stClear.dataset.vready = '';
  }
  // --- web (HTML) project layer -------------------------------------------
  var web = document.getElementById(MARKER + '-web');
  if (SHOW_WEB) {
    if (!web) {
      web = document.createElement('iframe');
      web.id = MARKER + '-web';
      web.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      web.setAttribute('scrolling', 'no');
      web.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none;background:transparent';
      stage.appendChild(web);
    }
    if (web.getAttribute('src') !== WEB_URL) web.src = WEB_URL;
    web.style.display = 'block';
    if (poster) poster.style.display = 'none';
  } else if (web) {
    web.style.display = 'none';
  }

  // --- dim overlay ---------------------------------------------------------
  var dim = document.getElementById(MARKER + '-dim');
  if (!dim) {
    dim = document.createElement('div');
    dim.id = MARKER + '-dim';
    stage.appendChild(dim);
  }
  dim.style.background = 'rgb(0 0 0 / ' + DIM + ')';
  try { document.documentElement.style.setProperty('--zcode-livewall-dim', String(DIM)); } catch (e) {}

  // --- pause when hidden or unfocused -------------------------------------
  if (!state.visibilityHooked) {
    state.visibilityHooked = true;
    state.syncPlayback = function () {
      var v = document.getElementById(MARKER + '-video');
      var c = state.config || {};
      if (!v) return;
      var shouldPause = c.paused || (c.pauseOnBlur && document.visibilityState === 'hidden');
      if (shouldPause) { try { v.pause(); } catch (e) {} }
      else { var q = v.play(); if (q && q.catch) q.catch(function () {}); }
      v.playbackRate = c.speed || 1;
    };
    document.addEventListener('visibilitychange', state.syncPlayback);
    window.addEventListener('blur', state.syncPlayback);
    window.addEventListener('focus', state.syncPlayback);
  }
  if (state.syncPlayback) state.syncPlayback();

  // --- media sizing --------------------------------------------------------
  /**
   * Size the media explicitly for both fit modes.
   *
   * contain: largest box with the media's own ratio that fits the stage.
   * cover:   smallest box that covers the stage; overflow is cropped.
   *
   * Done in JS because the intrinsic size is only known after load, and
   * because CSS auto sizing never scales a small image up. Also flags sources
   * too small to look sharp (stage.dataset.upscale).
   */
  function applyMediaSizing() {
    var st = document.getElementById(STAGE);
    if (!st) return;
    var mode = st.dataset.fit || 'cover';
    var w = st.clientWidth || window.innerWidth;
    var h = st.clientHeight || window.innerHeight;
    var dpr = window.devicePixelRatio || 1;

    [document.getElementById(MARKER + '-video'),
     document.getElementById(MARKER + '-poster')].forEach(function (el) {
      if (!el) return;
      var iw = el.naturalWidth || el.videoWidth || 0;
      var ih = el.naturalHeight || el.videoHeight || 0;
      if (!iw || !ih) return;
      var scale = mode === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
      el.style.width = Math.round(iw * scale) + 'px';
      el.style.height = Math.round(ih * scale) + 'px';
      el.style.removeProperty('margin');
      if (el.style.transform === 'none') el.style.removeProperty('transform');

      var coverScale = Math.max((w * dpr) / iw, (h * dpr) / ih);
      st.dataset.upscale = coverScale > 1.5 ? String(Math.round(coverScale * 10) / 10) : '';
    });
  }

  state.applyMediaSizing = applyMediaSizing;
  applyMediaSizing();

  if (!state.resizeHooked) {
    state.resizeHooked = true;
    window.addEventListener('resize', function () {
      if (state.applyMediaSizing) state.applyMediaSizing();
    });
  }

  // --- persistence for the panel's self-heal path --------------------------
  try {
    localStorage.setItem(MARKER + ':css', CSS);
    localStorage.setItem(MARKER + ':meta', JSON.stringify(state.config));
  } catch (e) {}
})();`;
}

export function buildResetScript(): string {
  // The panel's self-heal path re-creates the layer from these keys: leaving
  // them after a reset resurrects the wallpaper (with a dead media token after
  // a serve restart) on the next renderer reload. A true reset removes them.
  return `(function(){
  document.getElementById(${JSON.stringify(MARKER)} + '-style')?.remove();
  document.getElementById(${JSON.stringify(MARKER)} + '-stage')?.remove();
  document.getElementById(${JSON.stringify(MARKER)} + '-frost')?.remove();
  try {
    localStorage.removeItem(${JSON.stringify(MARKER)} + ':css');
    localStorage.removeItem(${JSON.stringify(MARKER)} + ':meta');
  } catch (e) {}
  if (window.__zcodeLivewall) {
    try { window.__zcodeLivewall.visibilityHooked = false; window.__zcodeLivewall.gestureHooked = false; } catch (e) {}
  }
})();`;
}
