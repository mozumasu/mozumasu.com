// mozumasu.com / talks.mozumasu.com 共通の背景。水面を WebGL で描き、.glass 要素の位置に厚いガラス板を描く。
// 使い方: <canvas id="water" class="bg"></canvas> を置き、このファイルを defer で読む。
// .glass 要素を後から追加したら document.dispatchEvent(new Event("glasschange")) で知らせる。
// ?t=<秒> で固定フレーム (スクリーンショット用)。prefers-reduced-motion では 1 フレームだけ描く。
//
// 3 パスで描く。水面はビューポート大のテクスチャに画面座標で描く (模様は画面に固定)。ドキュメント全体に
// 重ねた #water には、表示範囲の帯にテクスチャを貼り、その上に板を 1 枚ずつ矩形で描く。板はページ座標
// なので要素から遅れず、板の中も外も同じテクスチャを同じスクロール位置で参照するので縁で模様が繋がる。
(() => {
  const NOISE = `
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
float height(vec2 p, float t) {
  vec2 perp = vec2(-DIR.y, DIR.x);
  vec2 s = vec2(dot(p, DIR), dot(p, perp));
  float h = 0.0;
  h += 0.60 * fbm(s * vec2(0.55, 3.8) + vec2(-t * 0.30, t * 0.08));           // long swells, stretched along flow
  vec2 w = vec2(fbm(p * 3.0 + t * 0.18), fbm(p * 3.0 - t * 0.14 + 7.3));      // domain warp
  h += 0.26 * fbm(s * vec2(3.2, 6.5) + 1.2 * w + vec2(t * 0.22, -t * 0.18));
  h += 0.09 * fbm(p * 13.0 + 3.0 * w - vec2(t * 0.55, t * 0.35));             // fine wrinkles
  return h;
}
vec3 water(vec2 p, vec2 uv, float t) {
  float e = 0.0035;
  float h  = height(p, t);
  float hx = height(p + vec2(e, 0.0), t);
  float hy = height(p + vec2(0.0, e), t);
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
  float sparkle = smoothstep(0.5, 0.85, vnoise(p * 70.0 + t * 1.5));
  col += spec * (0.7 + 1.6 * sparkle);
  col += dark * sparkle * smoothstep(0.4, 0.6, vnoise(p * 30.0 - t)) * 0.35;
  return col;
}`;

  // pass 1: the water, in screen space, into a texture covering the viewport plus u_m px above and below
  const FRAG_WATER = `
precision highp float;
uniform vec2 u_vp;       // viewport in CSS px (large viewport height)
uniform float u_m;       // extra rows above and below the viewport, CSS px
uniform float u_dpr;     // texture px per CSS px
uniform float u_time;
uniform int u_oct;       // fbm octaves (5 desktop, 4 mobile)
${NOISE}
void main() {
  vec2 sc = gl_FragCoord.xy / u_dpr - vec2(0.0, u_m);   // CSS px, y up from the viewport's bottom edge
  vec2 uv = sc / u_vp;
  vec2 p = (sc - 0.5 * u_vp) / u_vp.y;
  gl_FragColor = vec4(pow(water(p, uv, u_time), vec3(0.96)), 1.0);
}`;

  // passes 2 and 3 draw on the document-sized canvas and look the water up in the texture by screen position
  const SCREEN = `
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_org;      // canvas px (y up) of the viewport's bottom-left corner
uniform float u_dpr;     // canvas px per CSS px
uniform vec2 u_vp;       // viewport in CSS px (large viewport height)
uniform float u_m;       // the texture covers -u_m .. u_vp.y + u_m vertically, CSS px
vec2 toUv(vec2 sc) { return vec2(sc.x / u_vp.x, (sc.y + u_m) / (u_vp.y + 2.0 * u_m)); }`;
  const FRAG_BLIT = `${SCREEN}
void main() {
  gl_FragColor = vec4(texture2D(u_tex, toUv((gl_FragCoord.xy - u_org) / u_dpr)).rgb, 1.0);
}`;
  // one quad per slab; every vertex carries its slab's box: center.xy + half-size.xy in canvas px (y up), corner radius
  const VS_SLAB = `
attribute vec2 a_pos; attribute vec4 a_rect; attribute float a_radius;
uniform vec2 u_res;
varying vec4 v_rect; varying float v_radius;
void main(){ v_rect = a_rect; v_radius = a_radius; gl_Position = vec4(a_pos / u_res * 2.0 - 1.0, 0.0, 1.0); }`;
  const FRAG_SLAB = `${SCREEN}
uniform vec2 u_texel;    // one texel in uv
uniform float u_glass;   // 0..1: strength of the slabs (1 unless a page wants them off)
uniform float u_disp;    // 1: per-channel refraction (dispersion), 0: single sample
varying vec4 v_rect; varying float v_radius;
// the slab shows a barely frosted view of the water
vec3 frost(vec2 uv) {
  vec2 o = u_texel * 0.75;
  return 0.25 * (texture2D(u_tex, uv + o).rgb + texture2D(u_tex, uv - o).rgb
               + texture2D(u_tex, uv + vec2(o.x, -o.y)).rgb + texture2D(u_tex, uv + vec2(-o.x, o.y)).rgb);
}
float sdRoundBox(vec2 q, vec2 b, float r) {
  vec2 d = abs(q) - b + vec2(r);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 q = fc - v_rect.xy;
  float sd = sdRoundBox(q, v_rect.zw, v_radius);
  if (sd >= 10.0 * u_dpr || u_glass < 0.01) discard;
  vec2 g = vec2(sdRoundBox(q + vec2(1.0, 0.0), v_rect.zw, v_radius) - sd, sdRoundBox(q + vec2(0.0, 1.0), v_rect.zw, v_radius) - sd);
  vec2 dir = normalize(g + vec2(1e-4, 0.0));
  float hs = min(v_rect.z, v_rect.w);
  float vpos = q.y / v_rect.w;
  vec2 sc = (fc - u_org) / u_dpr;                  // screen position in CSS px, y up
  float cover = 1.0 - smoothstep(-1.0, 1.0, sd);
  float edgeW = min(14.0 * u_dpr, 0.4 * hs);       // width of the refracting rim, px (kept small on small slabs)
  float rim = 1.0 - smoothstep(0.0, edgeW, -sd);   // 1 on the edge -> 0 inside
  float bend = rim * rim * (3.0 - 2.0 * rim);
  vec2 sun = normalize(vec2(-0.6, 0.8));
  float facing = dot(dir, sun);
  // thick clear glass: the core is a slightly magnified view of the water; the rim bends it inward by up to
  // 28 CSS px, each channel a little differently (dispersion)
  vec2 lens = q / u_dpr * 0.035;
  float k = min(28.0, 0.7 * hs / u_dpr);
  vec3 gcol;
  if (bend > 0.01 && u_disp > 0.5) {
    gcol.r = frost(toUv(sc - lens - dir * bend * k * 0.88)).r;
    gcol.g = frost(toUv(sc - lens - dir * bend * k * 1.00)).g;
    gcol.b = frost(toUv(sc - lens - dir * bend * k * 1.12)).b;
  } else {
    gcol = frost(toUv(sc - lens - dir * bend * k));
  }
  gcol = mix(gcol, vec3(1.0), 0.07) * 1.02;
  gcol += pow(rim, 4.0) * (0.25 + 0.75 * max(facing, 0.0)) * 0.7;            // specular on the rim facing the light
  gcol += pow(rim, 3.0) * max(-facing, 0.0) * 0.35 * vec3(0.9, 1.0, 1.0);    // light leaking through the far edge
  gcol -= pow(rim, 1.5) * (1.0 - abs(facing)) * 0.06;                        // sides a touch darker
  float gloss = smoothstep(0.2, 0.55, vpos) * (1.0 - smoothstep(0.7, 0.95, vpos));
  gcol += gloss * 0.10;                                                       // soft reflection streak near the top
  // light focused through the slab lands just outside its far edge
  float halo = (1.0 - smoothstep(0.0, 10.0 * u_dpr, sd)) * step(0.0, sd) * max(-facing, 0.0);
  // premultiplied: the slab replaces the water, the halo adds to it
  float a = cover * u_glass;
  gl_FragColor = vec4(gcol * a + halo * 0.16 * u_glass * vec3(0.95, 1.0, 1.0), a);
}`;

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
  const VS_TRI =
    "attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }";
  const program = (vs, fs) => {
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, "a_pos");
    gl.bindAttribLocation(prog, 1, "a_rect");
    gl.bindAttribLocation(prog, 2, "a_radius");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    return { prog, u: (name) => gl.getUniformLocation(prog, name) };
  };
  const W = program(VS_TRI, FRAG_WATER),
    B = program(VS_TRI, FRAG_BLIT),
    S = program(VS_SLAB, FRAG_SLAB);
  if (!W || !B || !S) {
    canvas.remove();
    return;
  }
  const triBuf = gl.createBuffer(),
    quadBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, triBuf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  const useTri = () => {
    gl.bindBuffer(gl.ARRAY_BUFFER, triBuf);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(2);
  };
  const useQuads = () => {
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 28, 0);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 8);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
  };
  // the water texture and the framebuffer that renders into it
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const wTime = W.u("u_time"),
    bOrg = B.u("u_org"),
    sOrg = S.u("u_org");

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
  gl.useProgram(W.prog);
  gl.uniform1i(W.u("u_oct"), mobile ? 4 : 5);
  gl.useProgram(B.prog);
  gl.uniform1i(B.u("u_tex"), 0);
  gl.useProgram(S.prog);
  gl.uniform1i(S.u("u_tex"), 0);
  gl.uniform1f(S.u("u_disp"), 1);
  gl.uniform1f(S.u("u_glass"), 1);

  document.body.classList.add("glassgl");
  // 100lvh: on phones the address bar changes innerHeight on every scroll. The texture is sized to the large
  // viewport so it is never reallocated then and the pattern never rescales
  const probe = document.body.appendChild(document.createElement("div"));
  probe.style.cssText =
    "position:fixed;top:0;height:100vh;height:100lvh;visibility:hidden;pointer-events:none";
  // Extra water above and below the viewport, in viewport heights: the compositor scrolls ahead of the frame
  // that is being painted, so the band must reach beyond what was visible when the frame started.
  const MARGIN = 0.15;
  let sx = 1,
    sy = 1,
    docH = 1, // document canvas: canvas px per CSS px, document height in CSS px
    vpW = 0,
    vpH = 0,
    marginPx = 0, // viewport in CSS px (large viewport height) and the margin
    texW = 0,
    texH = 0,
    slabVerts = 0;
  const docHeight = () =>
    Math.max(document.documentElement.scrollHeight, innerHeight);
  // element boxes in document space, read only when the layout may have changed
  const refreshGlass = () => {
    const data = [];
    const m = 12 * sx; // the halo reaches 10 CSS px outside the slab
    for (const el of document.querySelectorAll(".glass:not(.primary)")) {
      const b = el.getBoundingClientRect();
      if (!(b.width > 0)) continue;
      const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      const cx = (b.left + scrollX + b.width / 2) * sx,
        cy = canvas.height - (b.top + scrollY + b.height / 2) * sy,
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
    slabVerts = data.length / 7;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
  };
  const MAX_DIM = 8192; // stay well inside canvas size limits on long pages
  let allocW = 0,
    allocH = 0;
  const resize = () => {
    docH = docHeight();
    const w = document.documentElement.clientWidth;
    canvas.style.height = docH + "px";
    // Reallocating the bitmap blanks it. On phones the address bar showing and hiding fires resize on every
    // scroll, so small height changes only re-stretch the existing bitmap (a few percent, invisible).
    // Rows outside the band stay blank: the band is repainted from the texture every frame it can matter.
    const small = w === allocW && docH <= allocH && docH > allocH * 0.85;
    if (!small) {
      allocW = w;
      allocH = docH;
      const s = Math.min(scale, MAX_DIM / docH);
      canvas.width = Math.round(w * s);
      canvas.height = Math.round(docH * s);
      gl.useProgram(S.prog);
      gl.uniform2f(S.u("u_res"), canvas.width, canvas.height);
    }
    sx = canvas.width / w;
    sy = canvas.height / docH;
    const h = probe.clientHeight || innerHeight;
    if (w !== vpW || h !== vpH) {
      vpW = w;
      vpH = h;
      marginPx = Math.round(h * MARGIN);
      texW = Math.round(w * scale);
      texH = Math.round((h + 2 * marginPx) * scale);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texW, texH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.useProgram(W.prog);
      gl.uniform2f(W.u("u_vp"), w, h);
      gl.uniform1f(W.u("u_m"), marginPx);
      gl.uniform1f(W.u("u_dpr"), texW / w);
      for (const P of [B, S]) {
        gl.useProgram(P.prog);
        gl.uniform2f(P.u("u_vp"), w, h);
        gl.uniform1f(P.u("u_m"), marginPx);
      }
      gl.uniform2f(S.u("u_texel"), 1 / texW, 1 / texH);
    }
    for (const P of [B, S]) {
      gl.useProgram(P.prog);
      gl.uniform1f(P.u("u_dpr"), sx);
    }
    refreshGlass();
  };

  const drawWater = (t) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, texW, texH);
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(W.prog);
    gl.uniform1f(wTime, t);
    useTri();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  // paints the band around the viewport from the texture, then the slabs. whole: the entire document, for
  // still frames; rows beyond the texture repeat its edge, so only the first viewport of a still page is right
  const composite = (whole) => {
    const vy = scrollY;
    const m = whole ? docH : marginPx;
    const y0 = Math.max(0, vy - m),
      y1 = Math.min(docH, vy + vpH + m);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      0,
      Math.floor(canvas.height - y1 * sy),
      canvas.width,
      Math.ceil((y1 - y0) * sy) + 1,
    );
    const orgY = canvas.height - (vy + vpH) * sy;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.useProgram(B.prog);
    gl.uniform2f(bOrg, 0, orgY);
    useTri();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(S.prog);
    gl.uniform2f(sOrg, 0, orgY);
    useQuads();
    gl.enable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, slabVerts);
    gl.disable(gl.BLEND);
  };
  // the WebGL buffer is only presented from a frame callback, so even a single frame goes through rAF
  const drawStill = () =>
    requestAnimationFrame(() => {
      drawWater(stillTime);
      composite(true);
    });

  resize();
  const relayout = () => {
    if (docHeight() !== docH || canvas.style.height === "") resize();
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

  // The water is shaded at 30 fps on phones, 15 fps while the page scrolls, to leave the GPU to the compositor.
  // Compositing is cheap, so while the page scrolls the band is re-projected every frame: the water then trails
  // the page by at most one frame, and the slabs, drawn in page space, never trail at all.
  let lastScroll = -1e9;
  addEventListener(
    "scroll",
    () => {
      lastScroll = performance.now();
    },
    { passive: true },
  );
  let raf = 0,
    lastWater = 0;
  const t0 = performance.now();
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    const scrolling = now - lastScroll < 150;
    const interval = scrolling && mobile ? 66 : frameMs;
    const fresh = now - lastWater >= interval;
    if (fresh) {
      lastWater = now;
      drawWater((now - t0) / 1000);
    }
    if (fresh || scrolling) composite();
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
