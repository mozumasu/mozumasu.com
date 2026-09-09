// mozumasu.com / talks.mozumasu.com 共通の背景。水面を WebGL で描き、.glass 要素の位置に厚いガラス板を描く。
// 使い方: <canvas id="water" class="bg"></canvas> を置き、このファイルを defer で読む。
// .glass 要素を後から追加したら document.dispatchEvent(new Event("glasschange")) で知らせる。
// ?t=<秒> で固定フレーム (スクリーンショット用)。prefers-reduced-motion では 1 フレームだけ描く。
(() => {
  const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_dpr;
uniform float u_glass;   // 0..1: strength of the slabs (1 unless a page wants them off)
uniform vec4 u_view;     // visible viewport in canvas px: x, y (bottom-up), w, h. The canvas covers the whole document
uniform float u_disp;    // 1: per-channel refraction (dispersion), 0: single sample (mobile)
uniform int u_oct;       // fbm octaves (5 desktop, 4 mobile)
// glass slabs, taken from the DOM every frame: center.xy + half-size.xy in canvas px (y up), corner radius
const int MAXG = 16;
uniform vec4 u_rects[MAXG];
uniform float u_radii[MAXG];
uniform int u_count;

float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1, 0)), c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5; mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) { if (i >= u_oct) break; v += a * vnoise(p); p = m * p * 2.0 + vec2(1.7); a *= 0.5; }
  return v;
}
// flow runs diagonally (upper-left -> lower-right)
const vec2 DIR = vec2(0.92, -0.39);
// detail < 1 damps the fine wrinkles: used for the frosted look behind glass
float height(vec2 p, float t, float detail) {
  vec2 perp = vec2(-DIR.y, DIR.x);
  vec2 s = vec2(dot(p, DIR), dot(p, perp));
  float h = 0.0;
  h += 0.60 * fbm(s * vec2(0.55, 3.8) + vec2(-t * 0.30, t * 0.08));           // long swells, stretched along flow
  vec2 w = vec2(fbm(p * 3.0 + t * 0.18), fbm(p * 3.0 - t * 0.14 + 7.3));      // domain warp
  h += 0.26 * fbm(s * vec2(3.2, 6.5) + 1.2 * w + vec2(t * 0.22, -t * 0.18));
  h += 0.09 * detail * fbm(p * 13.0 + 3.0 * w - vec2(t * 0.55, t * 0.35));    // fine wrinkles
  return h;
}
vec3 water(vec2 p, vec2 uv, float t, float detail) {
  float e = 0.0035;
  float h  = height(p, t, detail);
  float hx = height(p + vec2(e, 0.0), t, detail);
  float hy = height(p + vec2(0.0, e), t, detail);
  vec3 n = normalize(vec3(-(hx - h) / e * 0.28, -(hy - h) / e * 0.28, 1.0));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(vec3(-0.45, 0.75, 0.55));

  // refracted bottom: sunlit sand + caustic web
  vec2 rp = p + n.xy * 0.14;
  float bn = fbm(rp * 2.2 + vec2(0.25 * t, -0.08 * t));
  float rid = 1.0 - abs(2.0 * fbm(rp * 6.5 + vec2(0.4 * t, 0.15 * t)) - 1.0);
  float caustic = pow(smoothstep(0.58, 1.0, rid), 2.2);
  vec3 bottom = mix(vec3(0.20, 0.60, 0.64), vec3(0.72, 0.88, 0.85), smoothstep(0.30, 0.78, bn));
  bottom += caustic * vec3(0.26, 0.28, 0.26);
  float diag = uv.x * 0.6 - uv.y * 0.8;                       // top-left < 0 < bottom-right
  bottom = mix(bottom, vec3(0.82, 0.93, 0.91), smoothstep(-0.25, -0.85, diag) * 0.55);
  bottom = mix(bottom, vec3(0.12, 0.64, 0.74), smoothstep(0.05, 0.65, diag) * 0.5);

  // reflection of the sky: bright where the surface tilts toward the light, near-black where it faces away
  vec3 R = reflect(-V, n);
  float tilt = clamp(0.5 + 0.9 * dot(R.xy, normalize(vec2(-1.0, 0.45))), 0.0, 1.0);
  vec3 skyDark = vec3(0.04, 0.17, 0.25);
  vec3 skyLight = vec3(0.86, 0.96, 0.97);
  vec3 refl = mix(skyDark, skyLight, smoothstep(0.35, 0.8, tilt));
  float fres = clamp(pow(1.0 - max(dot(n, V), 0.0), 2.5) * 6.0, 0.0, 1.0);
  float slope = length(n.xy);
  float dark = smoothstep(0.30, 0.66, slope) * (1.0 - smoothstep(0.26, 0.58, tilt));

  vec3 col = mix(bottom, refl, fres * 0.5);
  col = mix(col, skyDark, dark * 0.85);

  // sun glints on the crests
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(n, H), 0.0), 240.0);
  float sparkle = smoothstep(0.5, 0.85, vnoise(p * 70.0 + t * 1.5)) * detail;
  col += spec * (0.7 + 1.6 * sparkle);
  col += dark * sparkle * smoothstep(0.4, 0.6, vnoise(p * 30.0 - t)) * 0.35;
  return col;
}
float sdRoundBox(vec2 q, vec2 b, float r) {
  vec2 d = abs(q) - b + vec2(r);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}
void main() {
  vec2 fc = gl_FragCoord.xy;
  // the water is painted on the page (it scrolls with the content); only the tint gradient follows the viewport
  vec2 uv = (fc - u_view.xy) / u_view.zw;
  vec2 p = (fc - 0.5 * u_res) / u_view.w;
  float t = u_time;
  vec3 col = water(p, uv, t, 1.0);

  // nearest glass slab under this pixel
  float sd = 1e9; vec2 dir = vec2(0.0); float hs = 1.0; float vpos = 0.0; vec2 qn = vec2(0.0);
  for (int i = 0; i < MAXG; i++) {
    if (i >= u_count) break;
    vec4 r = u_rects[i];
    vec2 q = fc - r.xy;
    float s = sdRoundBox(q, r.zw, u_radii[i]);
    if (s < sd) {
      sd = s; hs = min(r.z, r.w); vpos = q.y / r.w; qn = q;
      vec2 g = vec2(sdRoundBox(q + vec2(1.0, 0.0), r.zw, u_radii[i]) - s, sdRoundBox(q + vec2(0.0, 1.0), r.zw, u_radii[i]) - s);
      dir = normalize(g + vec2(1e-4, 0.0));
    }
  }
  if (sd < 10.0 * u_dpr && u_glass > 0.01) {
    float cover = 1.0 - smoothstep(-1.0, 1.0, sd);
    float edgeW = min(14.0 * u_dpr, 0.4 * hs);     // width of the refracting rim, px (kept small on small slabs)
    float rim = 1.0 - smoothstep(0.0, edgeW, -sd);   // 1 on the edge -> 0 inside
    float bend = rim * rim * (3.0 - 2.0 * rim);
    vec2 sun = normalize(vec2(-0.6, 0.8));
    float facing = dot(dir, sun);
    // thick clear glass: the core is a slightly magnified, barely frosted view of the water;
    // the rim bends it inward, each channel a little differently (dispersion)
    vec2 lens = qn * 0.035 / u_view.w;
    vec3 gcol;
    float k = min(28.0 * u_dpr, 0.7 * hs) / u_view.w;
    if (bend > 0.01 && u_disp > 0.5) {
      gcol.r = water(p - lens - dir * bend * k * 0.88, uv, t, 0.75).r;
      gcol.g = water(p - lens - dir * bend * k * 1.00, uv, t, 0.75).g;
      gcol.b = water(p - lens - dir * bend * k * 1.12, uv, t, 0.75).b;
    } else {
      gcol = water(p - lens - dir * bend * k, uv, t, 0.75);
    }
    gcol = mix(gcol, vec3(1.0), 0.07) * 1.02;
    gcol += pow(rim, 4.0) * (0.25 + 0.75 * max(facing, 0.0)) * 0.7;            // specular on the rim facing the light
    gcol += pow(rim, 3.0) * max(-facing, 0.0) * 0.35 * vec3(0.9, 1.0, 1.0);    // light leaking through the far edge
    gcol -= pow(rim, 1.5) * (1.0 - abs(facing)) * 0.06;                        // sides a touch darker
    float gloss = smoothstep(0.2, 0.55, vpos) * (1.0 - smoothstep(0.7, 0.95, vpos));
    gcol += gloss * 0.10;                                                       // soft reflection streak near the top
    col = mix(col, gcol, cover * u_glass);
    // light focused through the slab lands just outside its far edge
    float halo = (1.0 - smoothstep(0.0, 10.0 * u_dpr, sd)) * step(0.0, sd) * max(-facing, 0.0);
    col += halo * 0.16 * u_glass * vec3(0.95, 1.0, 1.0);
  }
  gl_FragColor = vec4(pow(col, vec3(0.96)), 1.0);
}
`;

  const canvas = document.getElementById("water");
  if (!canvas) return;
  const gl = canvas.getContext("webgl", {
    antialias: false,
    alpha: false,
    powerPreference: "low-power",
  });
  if (!gl) {
    canvas.remove();
    return;
  } // the body gradient stays as the fallback
  const vs =
    "attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }";
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    canvas.remove();
    return;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const a = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(prog, "u_res"),
    uTime = gl.getUniformLocation(prog, "u_time"),
    uDpr = gl.getUniformLocation(prog, "u_dpr");
  const uRects = gl.getUniformLocation(prog, "u_rects"),
    uRadii = gl.getUniformLocation(prog, "u_radii"),
    uCount = gl.getUniformLocation(prog, "u_count");
  const uGlass = gl.getUniformLocation(prog, "u_glass"),
    uDisp = gl.getUniformLocation(prog, "u_disp"),
    uOct = gl.getUniformLocation(prog, "u_oct"),
    uView = gl.getUniformLocation(prog, "u_view");

  const params = new URLSearchParams(location.search);
  const fixed = params.get("t");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const still = fixed !== null || reduced;
  const stillTime = fixed !== null ? +fixed : 2.5;
  // phones get a cheaper shader: lower resolution, 4 octaves, no dispersion, 30 fps
  const mobile = innerWidth < 720 || matchMedia("(pointer: coarse)").matches;
  const scale =
    fixed !== null
      ? window.devicePixelRatio
      : mobile
        ? 0.7
        : Math.min(window.devicePixelRatio || 1, 1.0);
  const frameMs = mobile ? 30 : 0;
  gl.uniform1f(uDisp, mobile ? 0 : 1);
  gl.uniform1i(uOct, mobile ? 4 : 5);
  gl.uniform1f(uGlass, 1);

  // The canvas is laid over the whole document and scrolls with it, so the slabs can never trail the
  // elements. Each frame only the visible part (plus a margin) is shaded via the scissor rect.
  document.body.classList.add("glassgl");
  const MAXG = 16,
    rects = new Float32Array(MAXG * 4),
    radii = new Float32Array(MAXG);
  let glassEls = [];
  let sx = 1,
    sy = 1,
    docH = 1,
    fullFrame = true;
  const docHeight = () => Math.max(document.documentElement.scrollHeight, innerHeight);
  // element boxes in document space, read only when the layout may have changed
  const refreshGlass = () => {
    glassEls = [...document.querySelectorAll(".glass:not(.primary)")]
      .map((el) => {
        const b = el.getBoundingClientRect();
        return {
          x: b.left + scrollX,
          y: b.top + scrollY,
          w: b.width,
          h: b.height,
          r: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0,
        };
      })
      .filter((g) => g.w > 0);
    let n = 0;
    for (const g of glassEls) {
      if (n >= MAXG) break;
      rects[n * 4] = (g.x + g.w / 2) * sx;
      rects[n * 4 + 1] = canvas.height - (g.y + g.h / 2) * sy;
      rects[n * 4 + 2] = (g.w / 2) * sx;
      rects[n * 4 + 3] = (g.h / 2) * sy;
      radii[n] = Math.min(g.r, g.w / 2, g.h / 2) * sx;
      n++;
    }
    gl.uniform4fv(uRects, rects);
    gl.uniform1fv(uRadii, radii);
    gl.uniform1i(uCount, n);
  };
  const MAX_DIM = 8192; // stay well inside canvas size limits on long pages
  const resize = () => {
    docH = docHeight();
    const w = document.documentElement.clientWidth;
    canvas.style.height = docH + "px";
    const s = Math.min(scale, MAX_DIM / docH);
    canvas.width = Math.round(w * s);
    canvas.height = Math.round(docH * s);
    sx = canvas.width / w;
    sy = canvas.height / docH;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uDpr, sx);
    refreshGlass();
    fullFrame = true; // a resized canvas is blank, so paint all of it once
  };

  const draw = (t) => {
    const vh = innerHeight,
      vy = scrollY;
    const margin = fullFrame ? docH : vh * 0.3; // pre-shade a band around the viewport so fast scrolls never expose a stale row
    const y0 = Math.max(0, vy - margin),
      y1 = Math.min(docH, vy + vh + margin);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, Math.floor(canvas.height - y1 * sy), canvas.width, Math.ceil((y1 - y0) * sy) + 1);
    gl.uniform4f(uView, 0, canvas.height - (vy + vh) * sy, canvas.width, vh * sy);
    gl.uniform1f(uTime, t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    fullFrame = false;
  };
  // the WebGL buffer is only presented from a frame callback, so even a single frame goes through rAF
  const drawStill = () => requestAnimationFrame(() => { fullFrame = true; draw(stillTime); });

  resize();
  const relayout = () => {
    if (docHeight() !== docH || canvas.style.height === "") resize();
    else refreshGlass();
    if (still) drawStill();
  };
  addEventListener("resize", () => { resize(); if (still) drawStill(); });
  document.addEventListener("glasschange", relayout);
  addEventListener("load", relayout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
  if (window.ResizeObserver) new ResizeObserver(relayout).observe(document.body);
  setInterval(relayout, 1500); // cheap safety net for layout shifts nothing above catches
  if (still) {
    drawStill();
    return;
  }

  const t0 = performance.now();
  let raf = 0,
    lastFrame = 0;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    if (now - lastFrame < frameMs) return;
    lastFrame = now;
    draw((now - t0) / 1000);
  };
  const start = () => {
    if (!raf) raf = requestAnimationFrame(loop);
  };
  const stop = () => {
    cancelAnimationFrame(raf);
    raf = 0;
  };
  document.addEventListener("visibilitychange", () =>
    document.hidden ? stop() : start(),
  );
  start();
})();
