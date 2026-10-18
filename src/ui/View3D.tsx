/**
 * Vue 3D du montage : roues à leur position axiale, tiges, arbre et corps du moteur (schématique),
 * flasques en transparence. Les roues tournent avec l'animation de la vue 2D.
 * Glisser : orbite · Maj + glisser ou clic droit : déplacer · molette : zoom · clic : sélection.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { WORLD, toWorld, type Assembly, type Frame } from '../core/assembly';
import { extrudePrism, ringShape, type Mesh3D } from '../core/export';
import { solidMesh } from '../core/gearkinds';
import type { SafetyLevel } from '../core/strength';
import type { Pose, TrainAnalysis } from '../core/train';
import { MM } from '../core/units';
import { createRenderer, cssColor, lookAt, modelZ, multiply, normalize, perspective, release, upload, type GpuMesh, type Renderer, type Vec3 } from './gl';

export interface Show3D {
  plates: boolean;
  rods: boolean;
  motor: boolean;
  safety: boolean;
}

interface Props {
  train: TrainAnalysis;
  asm: Assembly;
  poses: Pose[];
  levels: Map<string, SafetyLevel>;
  show: Show3D;
  selectedId?: string;
  onSelect: (id: string) => void;
  /** incrémenté pour recadrer la vue */
  fitSignal: number;
}

interface Camera { yaw: number; pitch: number; dist: number; target: Vec3 }

/** corps du moteur, schématique (mm) */
const MOTOR_R = 6;
const MOTOR_L = 25;
const K = 1 / MM; // m → mm

/** Matrice (mm) du repère d'un groupe d'axes. */
const frameMatrix = (f: Frame) =>
  new Float32Array([...f.u, 0, ...f.v, 0, ...f.w, 0, f.o[0] * K, f.o[1] * K, f.o[2] * K, 1]);

interface Item { mesh: string; model: Float32Array; color: Vec3; alpha: number; pick?: string }

export function View3D({ train, asm, poses, levels, show, selectedId, onSelect, fitSignal }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rRef = useRef<Renderer | null>(null);
  const meshes = useRef(new Map<string, GpuMesh>());
  const [error, setError] = useState('');
  const [size, setSize] = useState({ w: 1, h: 1 });

  // encombrement de la scène (mm)
  const bounds = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let z0 = -MOTOR_L * MM, z1 = asm.innerHeight + 3 * MM;
    for (const n of train.nodes) {
      const r = n.geo.kind === 'rack' ? n.geo.z * n.geo.pt / 2 : n.geo.kind === 'internal' ? n.geo.rf + n.spec.rimWidth : n.geo.ra;
      const cx = n.geo.kind === 'rack' ? n.x + n.rackShift! * Math.cos(n.rackAngle!) : n.x;
      const cy = n.geo.kind === 'rack' ? n.y + n.rackShift! * Math.sin(n.rackAngle!) : n.y;
      const p = asm.placed[n.id];
      const c = toWorld(asm.groups[p?.group ?? 0] ?? WORLD, cx, cy, (p?.z ?? 0) + (p?.width ?? 0) / 2);
      const R = Math.hypot(r, (p?.width ?? 0) / 2);
      x0 = Math.min(x0, c[0] - R); x1 = Math.max(x1, c[0] + R);
      y0 = Math.min(y0, c[1] - R); y1 = Math.max(y1, c[1] + R);
      z0 = Math.min(z0, c[2] - R); z1 = Math.max(z1, c[2] + R);
    }
    return { c: [((x0 + x1) / 2) * K, ((y0 + y1) / 2) * K, ((z0 + z1) / 2) * K] as Vec3, r: (Math.max(x1 - x0, y1 - y0, z1 - z0) / 2) * K };
  }, [train, asm]);

  const cam = useRef<Camera>({ yaw: -Math.PI / 3, pitch: 0.55, dist: 100, target: [0, 0, 0] });
  const interacted = useRef(false);
  const fit = () => {
    // tient compte de l'écran étroit (champ de vision vertical fixe)
    const c = canvasRef.current;
    const aspect = c && c.clientHeight ? c.clientWidth / c.clientHeight : 1.5;
    const d = (bounds.r * 1.15) / Math.tan((35 * Math.PI) / 360) / Math.min(1, aspect);
    cam.current = { ...cam.current, dist: Math.max(20, d), target: [...bounds.c] };
    interacted.current = false;
  };
  const fitKey = `${train.mode}:${train.nodes.length}`;
  useEffect(fit, [fitKey, fitSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  // contexte WebGL
  useEffect(() => {
    const c = canvasRef.current!;
    try {
      rRef.current = createRenderer(c);
      if (!rRef.current) setError('WebGL 2 n\'est pas disponible dans ce navigateur : la vue 3D ne peut pas s\'afficher.');
    } catch (e) {
      setError(`Vue 3D indisponible : ${(e as Error).message}`);
    }
    const ro = new ResizeObserver(() => setSize({ w: c.clientWidth, h: c.clientHeight }));
    ro.observe(c);
    const prevent = (e: WheelEvent) => e.preventDefault();
    c.addEventListener('wheel', prevent, { passive: false });
    return () => {
      ro.disconnect();
      c.removeEventListener('wheel', prevent);
      const r = rRef.current;
      if (r) for (const m of meshes.current.values()) release(r, m);
      meshes.current.clear();
    };
  }, []);

  // maillages : reconstruits quand le train ou le montage change
  useEffect(() => {
    const r = rRef.current;
    if (!r) return;
    for (const m of meshes.current.values()) release(r, m);
    meshes.current.clear();
    const put = (key: string, m: Mesh3D) => meshes.current.set(key, upload(r, m));
    for (const n of train.nodes) put(`g:${n.id}`, solidMesh(n.solid));
    for (const p of asm.parts) p.collars.forEach((c, i) => put(`c:${p.id}:${i}`, extrudePrism(ringShape(c.r, c.bore), c.h)));
    for (const s of asm.shafts) put(`s:${s.id}`, extrudePrism(ringShape(s.radius, 0, 24), s.zTo - s.zFrom));
    asm.plates.forEach((p, i) => put(`p:${i}`, extrudePrism(p.shape, p.thickness)));
    put('motor', extrudePrism(ringShape(MOTOR_R * MM, 0, 48), MOTOR_L * MM));
    if (train.mode === 'planetary') put('motorShaft', extrudePrism(ringShape(1.5 * MM, 0, 24), MOTOR_L * MM * 0.4 + asm.innerHeight));
  }, [train, asm]);

  // scène à dessiner
  const items = (): Item[] => {
    const st = getComputedStyle(canvasRef.current!);
    const col = (v: string, f: Vec3) => cssColor(st.getPropertyValue(v), f);
    const gear = col('--gear', [0.79, 0.84, 0.92]);
    const accent = col('--accent', [0.18, 0.43, 0.86]);
    const lv: Record<SafetyLevel, Vec3> = { ok: col('--ok', [0.12, 0.54, 0.3]), marginal: col('--warn', [0.76, 0.48, 0]), danger: col('--danger', [0.75, 0.22, 0.17]) };
    const metal: Vec3 = [0.62, 0.65, 0.7];
    const out: Item[] = [];
    const frameOf = (id: string) => frameMatrix(asm.groups[asm.placed[id]?.group ?? 0] ?? WORLD);
    const colorOf = (id: string): Vec3 => {
      if (id === selectedId) return accent;
      const l = levels.get(id);
      if (show.safety && l) return lv[l].map((c, i) => c * 0.75 + gear[i] * 0.25) as Vec3;
      return gear;
    };
    for (const p of poses) {
      const z = asm.placed[p.nodeId]?.z ?? 0;
      out.push({ mesh: `g:${p.nodeId}`, model: multiply(frameOf(p.nodeId), modelZ(p.angle, p.x * K, p.y * K, z * K)), color: colorOf(p.nodeId), alpha: 1, pick: p.nodeId });
    }
    for (const part of asm.parts) {
      const pose = poses.find((x) => x.nodeId === part.nodeIds[0]);
      part.collars.forEach((c, i) => out.push({ mesh: `c:${part.id}:${i}`, model: multiply(frameOf(part.nodeIds[0]), modelZ(0, (pose?.x ?? 0) * K, (pose?.y ?? 0) * K, c.z * K)), color: colorOf(part.nodeIds[0]), alpha: 1, pick: part.nodeIds[0] }));
    }
    if (show.rods) for (const s of asm.shafts) out.push({ mesh: `s:${s.id}`, model: multiply(frameMatrix(asm.groups[s.group] ?? WORLD), modelZ(0, s.x * K, s.y * K, s.zFrom * K)), color: metal, alpha: 1 });
    const motorNode = train.nodes.find((n) => n.id === train.motorId);
    if (show.motor && motorNode) {
      const plate = asm.plates[0]?.thickness ?? 0;
      out.push({ mesh: 'motor', model: modelZ(0, motorNode.x * K, motorNode.y * K, (-plate - MOTOR_L * MM) * K), color: [0.55, 0.57, 0.6], alpha: 1 });
      if (train.mode === 'planetary') out.push({ mesh: 'motorShaft', model: modelZ(0, 0, 0, -MOTOR_L * MM * 0.4 * K), color: metal, alpha: 1 });
    }
    if (show.plates) asm.plates.forEach((p, i) => out.push({ mesh: `p:${i}`, model: modelZ(0, 0, 0, p.z * K), color: col('--muted', [0.4, 0.44, 0.52]), alpha: 0.28 }));
    return out;
  };

  const viewProj = (w: number, h: number) => {
    const c = cam.current;
    const eye: Vec3 = [
      c.target[0] + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw),
      c.target[1] + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw),
      c.target[2] + c.dist * Math.sin(c.pitch),
    ];
    const vp = multiply(perspective((35 * Math.PI) / 180, w / h, c.dist / 50, c.dist * 10), lookAt(eye, c.target, [0, 0, 1]));
    return { vp, eye };
  };

  const draw = () => {
    const r = rRef.current;
    const c = canvasRef.current;
    if (!r || !c) return;
    const { gl, loc } = r;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    const bg = cssColor(getComputedStyle(c).getPropertyValue('--bg'), [0.96, 0.96, 0.97]);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(r.prog);
    const { vp, eye } = viewProj(w, h);
    gl.uniformMatrix4fv(loc.viewProj, false, vp);
    gl.uniform3fv(loc.eye, eye);
    gl.uniform1i(loc.flat, 0);
    const list = items();
    const pass = (transparent: boolean) => {
      for (const it of list) {
        if ((it.alpha < 1) !== transparent) continue;
        const m = meshes.current.get(it.mesh);
        if (!m) continue;
        gl.uniformMatrix4fv(loc.model, false, it.model);
        gl.uniform3fv(loc.color, it.color);
        gl.uniform1f(loc.alpha, it.alpha);
        gl.bindVertexArray(m.vao);
        gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
      }
    };
    pass(false);
    // flasques transparents : dessinés en dernier, sans écrire la profondeur
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    pass(true);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  };
  // redessin à chaque rendu (l'animation fait avancer les poses)
  useEffect(draw);
  useEffect(() => {
    if (!interacted.current) fit();
    draw();
  }, [size]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Sélection : rendu des roues en couleurs d'identification dans un tampon hors écran. */
  const pick = (cx: number, cy: number) => {
    const r = rRef.current;
    const c = canvasRef.current;
    if (!r || !c) return;
    const { gl, loc } = r;
    const w = c.width, h = c.height;
    const fb = gl.createFramebuffer();
    const tex = gl.createRenderbuffer();
    const depth = gl.createRenderbuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.bindRenderbuffer(gl.RENDERBUFFER, tex);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, tex);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(r.prog);
    gl.uniformMatrix4fv(loc.viewProj, false, viewProj(w, h).vp);
    gl.uniform1i(loc.flat, 1);
    const ids: string[] = [];
    for (const it of items()) {
      if (it.alpha < 1) continue;
      const m = meshes.current.get(it.mesh);
      if (!m) continue;
      let code = 0;
      if (it.pick) {
        code = ids.indexOf(it.pick) + 1 || ids.push(it.pick);
      }
      gl.uniformMatrix4fv(loc.model, false, it.model);
      gl.uniform3fv(loc.color, [(code & 255) / 255, ((code >> 8) & 255) / 255, 0]);
      gl.bindVertexArray(m.vao);
      gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
    }
    const px = new Uint8Array(4);
    const dpr = w / c.clientWidth;
    gl.readPixels(Math.round(cx * dpr), Math.round(h - cy * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteRenderbuffer(tex);
    gl.deleteRenderbuffer(depth);
    const code = px[0] + (px[1] << 8);
    if (code > 0 && ids[code - 1]) onSelect(ids[code - 1]);
    draw();
  };

  const drag = useRef<{ x: number; y: number; sx: number; sy: number; pan: boolean; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, pan: e.shiftKey || e.button === 2, moved: false };
    interacted.current = true;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY;
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
    const c = cam.current;
    if (d.pan) {
      const h = canvasRef.current!.clientHeight;
      const k = (2 * c.dist * Math.tan((35 * Math.PI) / 360)) / h;
      const right = normalize([-Math.sin(c.yaw), Math.cos(c.yaw), 0]);
      const up: Vec3 = [-Math.sin(c.pitch) * Math.cos(c.yaw), -Math.sin(c.pitch) * Math.sin(c.yaw), Math.cos(c.pitch)];
      c.target = [0, 1, 2].map((i) => c.target[i] - right[i] * dx * k + up[i] * dy * k) as Vec3;
    } else {
      c.yaw -= dx * 0.008;
      c.pitch = Math.max(-1.5, Math.min(1.5, c.pitch + dy * 0.008));
    }
    draw();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      const rect = canvasRef.current!.getBoundingClientRect();
      pick(e.clientX - rect.left, e.clientY - rect.top);
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    cam.current.dist *= Math.exp(e.deltaY * 0.0015);
    interacted.current = true;
    draw();
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className="scene scene3d"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {error && <p className="error-text small">{error}</p>}
    </>
  );
}
