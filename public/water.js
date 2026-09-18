// mozumasu.com / talks.mozumasu.com 共通の背景。水面を WebGL で描き、.glass 要素の位置に厚いガラス板を描く。
// 使い方: <canvas id="water" class="bg"></canvas> を置き、このファイルを defer で読む。
// .glass 要素を後から追加したら document.dispatchEvent(new Event("glasschange")) で知らせる。
// ?t=<秒> で固定フレーム (スクリーンショット用)。prefers-reduced-motion では 1 フレームだけ描く。
//
// 3 パスで描く。水面は表示範囲の帯をページ座標のままテクスチャに描き (スマホは低解像度)、ドキュメント全体に
// 重ねた #water の同じ帯にそのテクスチャを貼ってから、.glass 要素ごとの矩形でガラス板を描く。テクスチャの
// 行とページの行の対応は描いた時点で固定なので、スクロール位置で貼り直すことはなく、コンポジタとのずれも出ない。
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

  // Page coordinates throughout: CSS px, y up from the document's bottom edge (the canvas and the texture
  // are both y up). Pass 1: the water for a band of the page, into the texture.
  const FRAG_WATER = `
precision highp float;
uniform float u_ws;      // texture px per CSS px
uniform float u_bottom;  // page y of the texture's first row
uniform vec2 u_doc;      // document size
uniform vec4 u_view;     // viewport: x, y, w, h. h is the large viewport (phones: address bar hidden), so the
                         // pattern's scale does not change when the bar shows and hides
uniform float u_time;
uniform int u_oct;       // fbm octaves (5 desktop, 4 mobile)
${NOISE}
void main() {
  vec2 c = gl_FragCoord.xy / u_ws + vec2(0.0, u_bottom);
  vec2 uv = (c - u_view.xy) / u_view.zw;                      // only the tint gradient follows the viewport
  vec2 p = (c - vec2(0.5 * u_doc.x, u_doc.y)) / u_view.w;     // the pattern is painted on the page, from its top
  gl_FragColor = vec4(pow(water(p, uv, u_time), vec3(0.96)), 1.0);
}`;

  // passes 2 and 3 draw on the document-sized canvas and look the water up in the texture by page position
  const PAGE = `
precision highp float;
uniform sampler2D u_tex;
uniform float u_dpr;     // canvas px per CSS px
uniform float u_bottom;  // page y of the texture's first row
uniform vec2 u_texCss;   // texture size in CSS px
vec2 toUv(vec2 c) { return (c - vec2(0.0, u_bottom)) / u_texCss; }`;
  const FRAG_BLIT = `${PAGE}
void main() {
  gl_FragColor = vec4(texture2D(u_tex, toUv(gl_FragCoord.xy / u_dpr)).rgb, 1.0);
}`;
  // one quad per slab; every vertex carries its slab's box: center.xy + half-size.xy in canvas px (y up), corner radius
  const VS_SLAB = `
attribute vec2 a_pos; attribute vec4 a_rect; attribute float a_radius;
uniform vec2 u_res;
varying vec4 v_rect; varying float v_radius;
void main(){ v_rect = a_rect; v_radius = a_radius; gl_Position = vec4(a_pos / u_res * 2.0 - 1.0, 0.0, 1.0); }`;
  const FRAG_SLAB = `${PAGE}
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
  vec2 c = fc / u_dpr;
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
    gcol.r = frost(toUv(c - lens - dir * bend * k * 0.88)).r;
    gcol.g = frost(toUv(c - lens - dir * bend * k * 1.00)).g;
    gcol.b = frost(toUv(c - lens - dir * bend * k * 1.12)).b;
  } else {
    gcol = frost(toUv(c - lens - dir * bend * k));
  }
  gcol = mix(gcol, vec3(1.0), 0.10) * 1.03;
  // light on thick glass: a crisp highlight on the outermost edge, a specular sweep on the lit rim, and a soft
  // shadow inside the bottom edge where the slab meets the water
  float edge = 1.0 - smoothstep(0.0, 2.5 * u_dpr, -sd);
  gcol += edge * (0.30 + 0.5 * max(facing, 0.0));
  gcol += pow(rim, 5.0) * (0.2 + 0.8 * max(facing, 0.0)) * 0.8;
  gcol += pow(rim, 3.0) * max(-facing, 0.0) * 0.4 * vec3(0.9, 1.0, 1.0);     // light leaking through the far edge
  gcol -= pow(rim, 1.5) * (1.0 - abs(facing)) * 0.08;                        // sides a touch darker
  gcol -= (1.0 - smoothstep(0.0, edgeW * 2.0, -sd)) * (1.0 - rim) * max(-dir.y, 0.0) * 0.10;
  gcol += smoothstep(-0.3, 1.0, vpos) * 0.10;                                // lit from above: the top is brighter
  // caustic: light focused through the slab lands just outside its far edge, fringed by dispersion. Every
  // channel fades out within the 10 px the fragment covers (see the discard above), or it ends in a hard line
  vec3 hw = vec3(7.5, 8.7, 10.0) * u_dpr;
  vec3 halo = (1.0 - smoothstep(vec3(0.0), hw, vec3(sd))) * step(0.0, sd) * max(-facing, 0.0);
  // premultiplied: the slab replaces the water, the caustic adds to it
  float a = cover * u_glass;
  gl_FragColor = vec4(gcol * a + halo * 0.2 * u_glass, a);
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
  const MAX_TEX = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const wTime = W.u("u_time"),
    wBottom = W.u("u_bottom"),
    wView = W.u("u_view"),
    bBottom = B.u("u_bottom"),
    sBottom = S.u("u_bottom");

  const params = new URLSearchParams(location.search);
  const fixed = params.get("t");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const still = fixed !== null || reduced;
  const stillTime = fixed !== null ? +fixed : 2.5;
  // Phones get a cheaper water: 4 octaves, 30 fps, and the texture at half the CSS resolution. The slabs are
  // drawn on the canvas at 0.7, so their rims stay crisp while the water underneath goes soft.
  const mobile = innerWidth < 720 || matchMedia("(pointer: coarse)").matches;
  const scale =
    fixed !== null
      ? window.devicePixelRatio
      : mobile
        ? 0.7
        : Math.min(window.devicePixelRatio || 1, 1.0);
  const ws = fixed === null && mobile ? 0.5 : scale;
  const frameMs = mobile ? 30 : 0;
  gl.useProgram(W.prog);
  gl.uniform1i(W.u("u_oct"), mobile ? 4 : 5);
  gl.uniform1f(W.u("u_ws"), ws);
  gl.useProgram(B.prog);
  gl.uniform1i(B.u("u_tex"), 0);
  gl.useProgram(S.prog);
  gl.uniform1i(S.u("u_tex"), 0);
  gl.uniform1f(S.u("u_disp"), 1);
  gl.uniform1f(S.u("u_glass"), 1);

  document.body.classList.add("glassgl");
  // 100lvh: on phones innerHeight changes with the address bar on every scroll; the pattern is scaled by this instead
  const probe = document.body.appendChild(document.createElement("div"));
  probe.style.cssText =
    "position:fixed;top:0;height:100vh;height:100lvh;visibility:hidden;pointer-events:none";
  // Rows beyond the viewport pre-shaded so a scroll never exposes a stale row before the next frame, in viewport
  // heights. Scrolling phones draw at 15 fps, so they need more; idle, the first frame of a scroll is drawn as
  // soon as its scroll event arrives.
  const MARGIN_IDLE = 0.3,
    MARGIN_SCROLL = 0.6;
  let sx = 1,
    sy = 1,
    docH = 1, // canvas px per CSS px, document height in CSS px
    vpW = 1,
    vhL = 1, // viewport width, large viewport height (CSS px)
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
    // Rows outside the band stay blank: the band is repainted every frame it can matter.
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
    vpW = w;
    vhL = probe.clientHeight || innerHeight;
    // the texture holds the widest band: the viewport plus the scrolling margin above and below
    const tw = Math.min(MAX_TEX, Math.round(w * ws)),
      th = Math.min(
        MAX_TEX,
        Math.ceil(Math.min(docH, vhL * (1 + 2 * MARGIN_SCROLL)) * ws) + 2,
      );
    if (tw !== texW || th !== texH) {
      texW = tw;
      texH = th;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texW, texH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const P of [B, S]) {
        gl.useProgram(P.prog);
        gl.uniform2f(P.u("u_texCss"), texW / ws, texH / ws);
      }
      gl.uniform2f(S.u("u_texel"), 1 / texW, 1 / texH);
    }
    gl.useProgram(W.prog);
    gl.uniform2f(W.u("u_doc"), w, docH);
    for (const P of [B, S]) {
      gl.useProgram(P.prog);
      gl.uniform1f(P.u("u_dpr"), sx);
    }
    refreshGlass();
  };

  // paints the band of the page between y0 and y1 (CSS px from the top): the water into the texture, the
  // texture onto the canvas, then the slabs
  const paint = (t, y0, y1) => {
    const rows = Math.min(texH, Math.ceil((y1 - y0) * ws) + 1);
    const bottom = docH - y1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, texW, rows);
    gl.disable(gl.SCISSOR_TEST);
    gl.useProgram(W.prog);
    gl.uniform1f(wBottom, bottom);
    gl.uniform4f(wView, 0, docH - (scrollY + vhL), vpW, vhL);
    gl.uniform1f(wTime, t);
    useTri();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      0,
      Math.floor(bottom * sy),
      canvas.width,
      Math.ceil((y1 - y0) * sy) + 1,
    );
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.useProgram(B.prog);
    gl.uniform1f(bBottom, bottom);
    useTri();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(S.prog);
    gl.uniform1f(sBottom, bottom);
    useQuads();
    gl.enable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, slabVerts);
    gl.disable(gl.BLEND);
  };
  // the whole document, in bands the texture can hold (still frames for screenshots at any scroll position)
  const paintAll = (t) => {
    const band = Math.floor((texH - 2) / ws);
    for (let y0 = 0; y0 < docH; y0 += band)
      paint(t, y0, Math.min(docH, y0 + band));
  };
  // the WebGL buffer is only presented from a frame callback, so even a single frame goes through rAF
  const drawStill = () => requestAnimationFrame(() => paintAll(stillTime));

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

  // The water keeps moving while the page scrolls: the canvas travels with the content, so nothing can drift.
  // Phones drop to 15 fps during a scroll to leave more of the GPU to the compositor.
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
    wasScrolling = false;
  const t0 = performance.now();
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    const scrolling = now - lastScroll < 150;
    const interval = scrolling && mobile ? 66 : frameMs;
    const started = scrolling && !wasScrolling;
    wasScrolling = scrolling;
    if (now - lastFrame < interval && !started) return;
    lastFrame = now;
    const vh = innerHeight,
      vy = scrollY,
      m = vh * (scrolling ? MARGIN_SCROLL : MARGIN_IDLE);
    paint((now - t0) / 1000, Math.max(0, vy - m), Math.min(docH, vy + vh + m));
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
