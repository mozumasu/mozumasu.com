// mozumasu.com / talks.mozumasu.com 共通の背景。水面と .glass 要素のガラス板を WebGL で描く。
// 使い方: <canvas id="water" class="bg"></canvas> を置き、このファイルを defer で読む。
// .glass 要素を後から追加したら document.dispatchEvent(new Event("glasschange")) で知らせる。
// ?t=<秒> で固定フレーム (スクリーンショット用)。prefers-reduced-motion では 1 フレームだけ描く。
//
// キャンバスは 2 枚:
// - 水面: このファイルが作るビューポート固定のキャンバス。模様は画面に固定で、スクロール位置に依存しない
// - ガラス板: #water。ドキュメント全体に重ねた透明なキャンバスに、板の矩形だけを描く。コンポジタが DOM ごと
//   動かすので板は要素から遅れない。板の中の水面は画面座標で参照するためスクロール中は 1 フレーム遅れるが、
//   屈折で曲げた内側なので見えない
(() => {
  const FRAG = `
precision highp float;
uniform float u_time;
uniform float u_dpr;     // canvas px per CSS px
uniform vec2 u_vp;       // viewport in CSS px. The height is the large viewport (100lvh): the phone's address bar must not rescale the pattern
uniform vec2 u_org;      // canvas px (y up) of the viewport's bottom-left corner
uniform int u_oct;       // fbm octaves (5 desktop, 4 mobile)
#ifdef GLASS
uniform float u_glass;   // 0..1: strength of the slabs (1 unless a page wants them off)
uniform float u_disp;    // 1: per-channel refraction (dispersion), 0: single sample
varying vec4 v_rect;     // slab center.xy + half-size.xy in canvas px (y up)
varying float v_radius;  // corner radius, canvas px
#endif

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
  vec2 sc = (fc - u_org) / u_dpr;           // screen position in CSS px, y up
  vec2 uv = sc / u_vp;                      // the tint gradient follows the viewport
  vec2 p = (sc - 0.5 * u_vp) / u_vp.y;      // the pattern is fixed to the screen
  float t = u_time;
#ifndef GLASS
  gl_FragColor = vec4(pow(water(p, uv, t, 1.0), vec3(0.96)), 1.0);
#else
  vec2 q = fc - v_rect.xy;
  float sd = sdRoundBox(q, v_rect.zw, v_radius);
  if (sd >= 10.0 * u_dpr || u_glass < 0.01) discard;
  vec2 g = vec2(sdRoundBox(q + vec2(1.0, 0.0), v_rect.zw, v_radius) - sd, sdRoundBox(q + vec2(0.0, 1.0), v_rect.zw, v_radius) - sd);
  vec2 dir = normalize(g + vec2(1e-4, 0.0));
  float hs = min(v_rect.z, v_rect.w);
  float vpos = q.y / v_rect.w;
  float cover = 1.0 - smoothstep(-1.0, 1.0, sd);
  float edgeW = min(14.0 * u_dpr, 0.4 * hs);     // width of the refracting rim, px (kept small on small slabs)
  float rim = 1.0 - smoothstep(0.0, edgeW, -sd);   // 1 on the edge -> 0 inside
  float bend = rim * rim * (3.0 - 2.0 * rim);
  vec2 sun = normalize(vec2(-0.6, 0.8));
  float facing = dot(dir, sun);
  float vh = u_vp.y * u_dpr;                       // viewport height in canvas px
  // thick clear glass: the core is a slightly magnified, barely frosted view of the water;
  // the rim bends it inward, each channel a little differently (dispersion)
  vec2 lens = q * 0.035 / vh;
  vec3 gcol;
  float k = min(28.0 * u_dpr, 0.7 * hs) / vh;
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
  gcol = pow(max(gcol, 0.0), vec3(0.96));
  // light focused through the slab lands just outside its far edge
  float halo = (1.0 - smoothstep(0.0, 10.0 * u_dpr, sd)) * step(0.0, sd) * max(-facing, 0.0);
  // premultiplied alpha: the slab replaces the water, the halo is a faint bright veil over it
  float a = cover * u_glass;
  float ha = halo * 0.2 * u_glass;
  gl_FragColor = vec4(gcol * a + vec3(0.95, 1.0, 1.0) * ha, a + ha);
#endif
}
`;
  const VS_WATER =
    "attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }";
  const VS_GLASS = `
attribute vec2 a_pos; attribute vec4 a_rect; attribute float a_radius;
uniform vec2 u_res;
varying vec4 v_rect; varying float v_radius;
void main(){ v_rect = a_rect; v_radius = a_radius; gl_Position = vec4(a_pos / u_res * 2.0 - 1.0, 0.0, 1.0); }`;

  const glassCanvas = document.getElementById("water");
  if (!glassCanvas) return;
  const waterCanvas = document.createElement("canvas");
  waterCanvas.className = "bg";
  waterCanvas.setAttribute("aria-hidden", "true");
  // 100lvh: the phone's address bar changes the visible height on every scroll. Sized to the large viewport the
  // canvas is never reallocated; the rows under the bar are simply hidden
  waterCanvas.style.height = "100vh";
  waterCanvas.style.height = "100lvh";
  glassCanvas.before(waterCanvas);
  const bail = () => {
    waterCanvas.remove();
    glassCanvas.remove();
  }; // the body gradient and the CSS glass stay as the fallback

  const setup = (canvas, vs, defines, opts) => {
    const gl = canvas.getContext("webgl", {
      antialias: false,
      powerPreference: "low-power",
      ...opts,
    });
    if (!gl) return null;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, defines + FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    const u = (name) => gl.getUniformLocation(prog, name);
    return { gl, prog, u };
  };
  const W = setup(waterCanvas, VS_WATER, "", { alpha: false });
  const G = setup(glassCanvas, VS_GLASS, "#define GLASS\n", { alpha: true });
  if (!W || !G) {
    bail();
    return;
  }

  // water: one full-screen triangle
  W.gl.bufferData(
    W.gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    W.gl.STATIC_DRAW,
  );
  const wPos = W.gl.getAttribLocation(W.prog, "a_pos");
  W.gl.enableVertexAttribArray(wPos);
  W.gl.vertexAttribPointer(wPos, 2, W.gl.FLOAT, false, 0, 0);
  // glass: one quad per slab; every vertex carries its slab's box (pos.xy, center.xy, half-size.xy, radius)
  const STRIDE = 7 * 4;
  for (const [name, size, offset] of [
    ["a_pos", 2, 0],
    ["a_rect", 4, 8],
    ["a_radius", 1, 24],
  ]) {
    const loc = G.gl.getAttribLocation(G.prog, name);
    G.gl.enableVertexAttribArray(loc);
    G.gl.vertexAttribPointer(loc, size, G.gl.FLOAT, false, STRIDE, offset);
  }
  G.gl.enable(G.gl.BLEND);
  G.gl.blendFunc(G.gl.ONE, G.gl.ONE_MINUS_SRC_ALPHA); // premultiplied: neighbouring halos overlap instead of clipping each other
  G.gl.clearColor(0, 0, 0, 0);

  const params = new URLSearchParams(location.search);
  const fixed = params.get("t");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const still = fixed !== null || reduced;
  const stillTime = fixed !== null ? +fixed : 2.5;
  // phones get a cheaper shader: lower resolution, 4 octaves, 30 fps (dispersion is rim-only and cheap, so it stays)
  const mobile = innerWidth < 720 || matchMedia("(pointer: coarse)").matches;
  const scale =
    fixed !== null
      ? window.devicePixelRatio
      : mobile
        ? 0.7
        : Math.min(window.devicePixelRatio || 1, 1.0);
  const frameMs = mobile ? 30 : 0;
  for (const C of [W, G]) C.gl.uniform1i(C.u("u_oct"), mobile ? 4 : 5);
  G.gl.uniform1f(G.u("u_disp"), 1);
  G.gl.uniform1f(G.u("u_glass"), 1);
  const wTime = W.u("u_time"),
    gTime = G.u("u_time"),
    gOrg = G.u("u_org");

  document.body.classList.add("glassgl");

  // ---- water canvas: fixed to the viewport ----
  let vpW = 1,
    vpH = 1, // CSS px; vpH is the large viewport height
    wAllocW = 0,
    wAllocH = 0;
  const resizeWater = () => {
    vpW = document.documentElement.clientWidth;
    vpH = waterCanvas.clientHeight || innerHeight;
    if (vpW !== wAllocW || vpH !== wAllocH) {
      wAllocW = vpW;
      wAllocH = vpH;
      waterCanvas.width = Math.round(vpW * scale);
      waterCanvas.height = Math.round(vpH * scale);
      W.gl.viewport(0, 0, waterCanvas.width, waterCanvas.height);
    }
    W.gl.uniform1f(W.u("u_dpr"), waterCanvas.width / vpW);
    W.gl.uniform2f(W.u("u_vp"), vpW, vpH);
    W.gl.uniform2f(W.u("u_org"), 0, 0);
    G.gl.uniform2f(G.u("u_vp"), vpW, vpH);
  };
  const drawWater = (t) => {
    W.gl.uniform1f(wTime, t);
    W.gl.drawArrays(W.gl.TRIANGLES, 0, 3);
  };

  // ---- glass canvas: laid over the whole document and scrolls with it, so the slabs can never trail the elements ----
  let sx = 1,
    sy = 1,
    docH = 1,
    glassVerts = 0;
  const docHeight = () =>
    Math.max(document.documentElement.scrollHeight, innerHeight);
  // element boxes in document space, read only when the layout may have changed
  const refreshGlass = () => {
    const data = [];
    const m = 12 * sx; // the halo reaches 10px outside the slab
    for (const el of document.querySelectorAll(".glass:not(.primary)")) {
      const b = el.getBoundingClientRect();
      if (!(b.width > 0)) continue;
      const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      const cx = (b.left + scrollX + b.width / 2) * sx,
        cy = glassCanvas.height - (b.top + scrollY + b.height / 2) * sy,
        hw = (b.width / 2) * sx,
        hh = (b.height / 2) * sy,
        rad = Math.min(r, b.width / 2, b.height / 2) * sx;
      const x0 = cx - hw - m,
        x1 = cx + hw + m,
        y0 = cy - hh - m,
        y1 = cy + hh + m;
      for (const [x, y] of [
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x0, y1],
        [x1, y0],
        [x1, y1],
      ])
        data.push(x, y, cx, cy, hw, hh, rad);
    }
    glassVerts = data.length / 7;
    G.gl.bufferData(
      G.gl.ARRAY_BUFFER,
      new Float32Array(data),
      G.gl.DYNAMIC_DRAW,
    );
  };
  const MAX_DIM = 8192; // stay well inside canvas size limits on long pages
  let allocW = 0,
    allocH = 0;
  const resizeGlass = () => {
    docH = docHeight();
    const w = document.documentElement.clientWidth;
    glassCanvas.style.height = docH + "px";
    // Reallocating the bitmap forces a repaint of the whole document. On phones the address bar showing and
    // hiding fires resize on every scroll, so small height changes only re-stretch the existing bitmap
    // (a few percent, invisible).
    const small = w === allocW && docH <= allocH && docH > allocH * 0.85;
    if (!small) {
      allocW = w;
      allocH = docH;
      const s = Math.min(scale, MAX_DIM / docH);
      glassCanvas.width = Math.round(w * s);
      glassCanvas.height = Math.round(docH * s);
      G.gl.viewport(0, 0, glassCanvas.width, glassCanvas.height);
      G.gl.uniform2f(G.u("u_res"), glassCanvas.width, glassCanvas.height);
    }
    sx = glassCanvas.width / w;
    sy = glassCanvas.height / docH;
    G.gl.uniform1f(G.u("u_dpr"), sx);
    refreshGlass();
  };
  // margin: how far beyond the viewport slabs are shaded, in viewport heights. While the page scrolls the canvas is
  // redrawn every frame or two, so a small band is enough; idle, the band must cover the first frame of a scroll
  // that starts before the next draw.
  const drawGlass = (t, margin) => {
    const gl = G.gl;
    const vh = innerHeight,
      vy = scrollY;
    margin = margin === undefined ? docH : vh * margin;
    const y0 = Math.max(0, vy - margin),
      y1 = Math.min(docH, vy + vh + margin);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      0,
      Math.floor(glassCanvas.height - y1 * sy),
      glassCanvas.width,
      Math.ceil((y1 - y0) * sy) + 1,
    );
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(gOrg, 0, glassCanvas.height - (vy + vpH) * sy);
    gl.uniform1f(gTime, t);
    gl.drawArrays(gl.TRIANGLES, 0, glassVerts);
  };

  const resize = () => {
    resizeWater();
    resizeGlass();
  };
  // the WebGL buffer is only presented from a frame callback, so even a single frame goes through rAF
  const drawStill = () =>
    requestAnimationFrame(() => {
      drawWater(stillTime);
      drawGlass(stillTime);
    });

  resize();
  const relayout = () => {
    if (docHeight() !== docH || glassCanvas.style.height === "") resizeGlass();
    else refreshGlass();
    if (still) drawStill();
  };
  addEventListener("resize", () => {
    resize();
    if (still) drawStill();
  });
  document.addEventListener("glasschange", relayout);
  addEventListener("load", relayout);
  if (document.fonts && document.fonts.ready)
    document.fonts.ready.then(relayout);
  if (window.ResizeObserver)
    new ResizeObserver(relayout).observe(document.body);
  setInterval(relayout, 1500); // cheap safety net for layout shifts nothing above catches
  if (still) {
    drawStill();
    return;
  }

  // Phones draw the water at 30 fps, 15 fps during a scroll, to leave more of the GPU to the compositor.
  // The slabs' water is sampled in screen space, so while the page scrolls they are redrawn more often than the
  // water (every frame on desktop, 30 fps on phones) using the time of the frame the water canvas is showing,
  // which keeps the pattern continuous across the rim.
  let lastScroll = -1e9;
  addEventListener(
    "scroll",
    () => {
      lastScroll = performance.now();
    },
    { passive: true },
  );
  let raf = 0,
    lastFrame = 0,
    lastGlass = 0,
    shownTime = 0;
  const t0 = performance.now();
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    const scrolling = now - lastScroll < 150;
    const interval = scrolling && mobile ? 66 : frameMs;
    if (now - lastFrame >= interval) {
      lastFrame = lastGlass = now;
      shownTime = (now - t0) / 1000;
      drawWater(shownTime);
      drawGlass(shownTime, scrolling ? 0.15 : 0.25);
    } else if (scrolling && now - lastGlass >= (mobile ? 30 : 0)) {
      lastGlass = now;
      drawGlass(shownTime, 0.15);
    }
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
