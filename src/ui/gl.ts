/**
 * Outils WebGL 2 minimaux pour la vue 3D : matrices 4×4 (colonnes), programme d'ombrage,
 * envoi des maillages. Les normales sont calculées dans le fragment shader (dFdx/dFdy) :
 * ombrage à facettes, sans tampon de normales.
 */
import type { Mesh3D } from '../core/export';

export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];

export function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = normalize(sub(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

/** Rotation d'angle a autour de z puis translation (x, y, z). */
export function modelZ(a: number, x: number, y: number, z: number): Mat4 {
  const c = Math.cos(a), s = Math.sin(a);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

const VS = `#version 300 es
in vec3 aPos;
uniform mat4 uModel;
uniform mat4 uViewProj;
out vec3 vW;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vW = w.xyz;
  gl_Position = uViewProj * w;
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vW;
uniform vec3 uColor;
uniform float uAlpha;
uniform vec3 uEye;
uniform int uFlat;
out vec4 outColor;
void main() {
  if (uFlat == 1) { outColor = vec4(uColor, 1.0); return; }
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  vec3 v = normalize(uEye - vW);
  if (dot(n, v) < 0.0) n = -n;
  vec3 key = normalize(vec3(0.35, -0.45, 0.82));
  float d = 0.28 + 0.5 * max(dot(n, key), 0.0) + 0.3 * max(dot(n, v), 0.0);
  float sp = 0.18 * pow(max(dot(n, normalize(key + v)), 0.0), 40.0);
  outColor = vec4(uColor * d + sp, uAlpha);
}`;

export interface Renderer {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  loc: {
    pos: number;
    model: WebGLUniformLocation;
    viewProj: WebGLUniformLocation;
    color: WebGLUniformLocation;
    alpha: WebGLUniformLocation;
    eye: WebGLUniformLocation;
    flat: WebGLUniformLocation;
  };
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: false });
  if (!gl) return null;
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
  const u = (n: string) => gl.getUniformLocation(prog, n)!;
  return {
    gl, prog,
    loc: { pos: gl.getAttribLocation(prog, 'aPos'), model: u('uModel'), viewProj: u('uViewProj'), color: u('uColor'), alpha: u('uAlpha'), eye: u('uEye'), flat: u('uFlat') },
  };
}

export interface GpuMesh {
  vao: WebGLVertexArrayObject;
  buffers: WebGLBuffer[];
  count: number;
}

export function upload(r: Renderer, m: Mesh3D): GpuMesh {
  const { gl } = r;
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, m.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(r.loc.pos);
  gl.vertexAttribPointer(r.loc.pos, 3, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, buffers: [vb, ib], count: m.indices.length };
}

export function release(r: Renderer, m: GpuMesh) {
  r.gl.deleteVertexArray(m.vao);
  for (const b of m.buffers) r.gl.deleteBuffer(b);
}

/** Couleur CSS (#rgb, #rrggbb ou rgb()) → composantes 0–1. */
export function cssColor(value: string, fallback: Vec3): Vec3 {
  const v = value.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16) / 255) as Vec3;
  const r = /rgba?\(([^)]+)\)/.exec(v);
  if (r) return r[1].split(',').slice(0, 3).map((x) => Number(x) / 255) as Vec3;
  return fallback;
}
