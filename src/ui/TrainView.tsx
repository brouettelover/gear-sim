/**
 * Vue animée du train, en 2D (SVG) ou en 3D (WebGL, voir View3D).
 * 2D : engrènement synchronisé sur la vitesse simulée (avec ralenti),
 * zoom (molette), déplacement (glisser le fond), placement des roues (glisser une roue),
 * superpositions : cercles primitifs, ligne d'action, points de contact, entraxes, encombrement.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Computed, Project } from '../core/project';
import { contactOverlay } from '../core/contact';
import { poses, snapPlacement, type ChainSpec, type TrainNode } from '../core/train';
import { defaultGear, newId } from '../core/project';
import { gearGeometry, meshGeometry } from '../core/involute';
import type { GearSpec } from '../core/types';
import { MM } from '../core/units';
import { fmt, toMm, toRpm } from '../core/units';
import type { Updater } from './App';
import { CheckField } from './fields';
import { LEVEL_COLORS, shapePath } from './svg';
import { View3D, type Show3D } from './View3D';

interface Props {
  project: Project;
  computed: Computed;
  update: Updater;
  selectedId?: string;
  onSelect: (id: string) => void;
}

interface Box { x: number; y: number; w: number; h: number }

type PaletteKind = 'spur' | 'internal' | 'rack' | 'rod';
const PALETTE: { kind: PaletteKind; label: string }[] = [
  { kind: 'spur', label: '⚙ Roue' },
  { kind: 'internal', label: '◎ Couronne' },
  { kind: 'rack', label: '▭ Crémaillère' },
  { kind: 'rod', label: '● Tige libre' },
];
/** distance d'accrochage à l'entraxe d'une roue voisine (m) */
const snapTol = (m: number) => Math.max(1.5 * MM, 1.5 * m);

/**
 * Roue qui fixe la position de la tige de `id` : on remonte les roues coaxiales jusqu'à celle qui
 * engrène avec sa menante (la tige tourne alors autour de celle-ci). Aucune sur l'arbre moteur.
 */
function shaftDrive(chain: ChainSpec, id: string): string | undefined {
  const byId = new Map(chain.gears.map((g) => [g.gear.id, g]));
  let g = byId.get(id);
  for (let i = 0; g && i < chain.gears.length; i++) {
    if (g.placement.kind === 'mesh') return g.gear.id;
    if (g.placement.kind === 'root') return undefined;
    if (g.placement.kind === 'free') return g.gear.id;
    g = byId.get(g.placement.parent);
  }
  return undefined;
}

/** Boîte englobante (mm) de toutes les roues au repos. */
function sceneBounds(nodes: TrainNode[], planetary: boolean) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number, r = 0) => {
    minX = Math.min(minX, x - r); maxX = Math.max(maxX, x + r);
    minY = Math.min(minY, y - r); maxY = Math.max(maxY, y + r);
  };
  for (const n of nodes) {
    if (n.geo.kind === 'rack') {
      const L = n.geo.z * n.geo.pt;
      const c = Math.cos(n.rackAngle!), s = Math.sin(n.rackAngle!);
      const lo = -L / 2 - n.geo.pt / 2;
      const hi = L / 2 - n.geo.pt / 2;
      for (const [u, v] of [[lo, n.geo.addendum], [hi, n.geo.addendum], [lo, -n.geo.dedendum - n.spec.rimWidth], [hi, -n.geo.dedendum - n.spec.rimWidth]]) {
        add(n.x + u * c - v * s, n.y + u * s + v * c);
      }
    } else if (n.geo.kind === 'internal') {
      add(n.x, n.y, n.geo.rf + n.spec.rimWidth);
    } else if (!planetary) {
      add(n.x, n.y, n.geo.ra);
    }
  }
  return { minX: toMm(minX), minY: toMm(minY), maxX: toMm(maxX), maxY: toMm(maxY) };
}

export function TrainView({ project, computed, update, selectedId, onSelect }: Props) {
  const { train, steady } = computed;
  const svgRef = useRef<SVGSVGElement>(null);
  const [slow, setSlow] = useState(-1); // log10 du facteur de ralenti
  const [playing, setPlaying] = useState(true);
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [show3d, setShow3d] = useState<Show3D>({ plates: true, rods: true, motor: true, safety: true });
  const [fitSignal, setFitSignal] = useState(0);
  const [opts, setOpts] = useState({ pitch: true, base: false, action: true, contacts: true, dims: true, bbox: false, safety: true });
  const [theta, setTheta] = useState(0);
  const thetaRef = useRef(0);
  const [box, setBox] = useState<Box | null>(null);
  const drag = useRef<{ kind: 'pan'; sx: number; sy: number; box: Box } | { kind: 'gear'; id: string; ox: number; oy: number } | { kind: 'rod'; id: string } | null>(null);
  // glisser-déposer depuis la palette : pièce en cours de dépôt et position du pointeur (écran)
  const [pal, setPal] = useState<{ kind: PaletteKind; cx: number; cy: number } | null>(null);

  const paths = useMemo(() => new Map(train.nodes.map((n) => [n.id, shapePath(n.shape)])), [train]);
  const bounds = useMemo(() => sceneBounds(train.nodes.filter((n) => n.group === 0), train.mode === 'planetary'), [train]);
  const fit = (): Box => {
    const m = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.08 + 2;
    // repère SVG : y vers le bas → on inverse y
    return { x: bounds.minX - m, y: -bounds.maxY - m, w: bounds.maxX - bounds.minX + 2 * m, h: bounds.maxY - bounds.minY + 2 * m };
  };
  const fitKey = `${train.mode}:${train.nodes.length}`;
  useEffect(() => setBox(fit()), [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // animation : θ moteur += ω·facteur·dt
  const omega = steady.stalled ? 0 : steady.omegaMotor;
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      thetaRef.current += omega * 10 ** slow * dt;
      setTheta(thetaRef.current);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, omega, slow]);

  const nodeById = new Map(train.nodes.map((n) => [n.id, n]));
  const allPoses = poses(train, theta);
  // vue 2D : seulement les axes parallèles à l'arbre moteur
  const ps = allPoses.filter((p) => nodeById.get(p.nodeId)!.group === 0);
  const hidden = train.nodes.some((n) => n.group !== 0);
  const strength = new Map(computed.strength.map((s) => [s.node.id, s]));

  // conversion écran → monde (mm, y vers le haut)
  const toWorld = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    const b = box ?? fit();
    const s = Math.max(b.w / r.width, b.h / r.height);
    const ox = b.x + (b.w - r.width * s) / 2;
    const oy = b.y + (b.h - r.height * s) / 2;
    return { x: ox + (e.clientX - r.left) * s, y: -(oy + (e.clientY - r.top) * s), s };
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!box) return;
    const p = toWorld(e);
    const k = Math.exp(e.deltaY * 0.0015);
    setBox({ x: p.x - (p.x - box.x) * k, y: -p.y - (-p.y - box.y) * k, w: box.w * k, h: box.h * k });
  };
  useEffect(() => {
    // empêche le défilement de la page pendant le zoom
    const el = svgRef.current;
    if (!el) return;
    const prevent = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', prevent, { passive: false });
    return () => el.removeEventListener('wheel', prevent);
  }, [mode]);

  const onPointerDown = (e: RPointerEvent, gearId?: string) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (gearId) {
      onSelect(gearId);
      const drive = train.mode === 'chain' ? shaftDrive(project.chain, gearId) : undefined;
      const dn = drive ? nodeById.get(drive) : undefined;
      if (drive && dn && dn.group === 0) {
        // on garde l'écart entre le pointeur et le centre de la roue saisie
        const w = toWorld(e);
        drag.current = { kind: 'gear', id: drive, ox: w.x - toMm(dn.x), oy: w.y - toMm(dn.y) };
        e.stopPropagation();
        return;
      }
    }
    if (box) drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, box };
  };
  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const r = svgRef.current!.getBoundingClientRect();
      const s = Math.max(d.box.w / r.width, d.box.h / r.height);
      setBox({ ...d.box, x: d.box.x - (e.clientX - d.sx) * s, y: d.box.y - (e.clientY - d.sy) * s });
      return;
    }
    if (d.kind === 'rod') {
      const w = toWorld(e);
      update((dr) => {
        const r = dr.assembly?.freeRods?.find((x) => x.id === d.id);
        // pas de 0,5 mm
        if (r) { r.x = (Math.round(w.x * 2) / 2) / 1000; r.y = (Math.round(w.y * 2) / 2) / 1000; }
      });
      return;
    }
    const self = nodeById.get(d.id);
    const tg = project.chain.gears.find((x) => x.gear.id === d.id);
    if (!self || !tg) return;
    const w = toWorld(e);
    // déplacement libre ; accrochage à l'entraxe d'une roue voisine
    const pl = snapPlacement(train, project.chain, self, (w.x - d.ox) * MM, (w.y - d.oy) * MM, snapTol(self.geo.mn));
    if (JSON.stringify(pl) === JSON.stringify(tg.placement)) return;
    update((dr) => {
      const g = dr.chain.gears.find((x) => x.gear.id === d.id);
      if (g) g.placement = pl;
    });
  };

  // --- palette : nouvelle pièce déposée dans la vue ---
  const base = project.chain.gears.find((g) => g.placement.kind === 'root')?.gear ?? project.chain.gears[0]?.gear;
  const paletteSpec = (kind: PaletteKind): GearSpec | null => {
    if (kind === 'rod') return null;
    const common = { module: base?.module ?? MM, pressureAngle: base?.pressureAngle ?? (20 * Math.PI) / 180, faceWidth: base?.faceWidth ?? 6 * MM, materialId: base?.materialId ?? 'PETG', bore: { type: 'round' as const, diameter: 3 * MM, flat: 0 } };
    const n = project.chain.gears.length + 1;
    if (kind === 'internal') return defaultGear({ ...common, name: `Couronne ${n}`, type: 'internal', teeth: 60, rimWidth: 3 * MM });
    if (kind === 'rack') return defaultGear({ ...common, name: `Crémaillère ${n}`, type: 'rack', teeth: 20, rimWidth: 3 * MM });
    return defaultGear({ ...common, name: `Roue ${n}`, teeth: 24 });
  };
  const inScene = (cx: number, cy: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    return !!r && cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  };
  /** placement de la pièce de la palette lâchée au point écran (cx, cy) */
  const palettePlacement = (kind: PaletteKind, cx: number, cy: number) => {
    const w = toWorld({ clientX: cx, clientY: cy });
    const spec = paletteSpec(kind);
    if (!spec) return { w, spec, geo: undefined, placement: undefined };
    const geo = gearGeometry(spec, project.print);
    return { w, spec, geo, placement: snapPlacement(train, project.chain, { geo, spec }, w.x * MM, w.y * MM, snapTol(geo.mn)) };
  };
  useEffect(() => {
    if (!pal) return;
    const move = (e: PointerEvent) => setPal((p) => (p ? { ...p, cx: e.clientX, cy: e.clientY } : p));
    const up = (e: PointerEvent) => {
      const kind = pal.kind;
      setPal(null);
      if (!inScene(e.clientX, e.clientY)) return;
      const { w, spec, placement } = palettePlacement(kind, e.clientX, e.clientY);
      if (!spec || !placement) {
        update((dr) => {
          const k = (dr.assembly.freeRods ?? []).length;
          dr.assembly.freeRods = [...(dr.assembly.freeRods ?? []), { id: newId(), name: `Colonne ${k + 1}`, x: (Math.round(w.x * 2) / 2) * MM, y: (Math.round(w.y * 2) / 2) * MM }];
        });
        return;
      }
      update((dr) => void dr.chain.gears.push({ gear: spec, placement }));
      setTimeout(() => onSelect(spec.id));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [pal?.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const ghost = pal && inScene(pal.cx, pal.cy) ? palettePlacement(pal.kind, pal.cx, pal.cy) : null;
  const ghostCenter = (() => {
    if (!ghost) return null;
    if (!ghost.geo || !ghost.placement) return { x: ghost.w.x, y: ghost.w.y, r: 1.5, snapped: false };
    const pl = ghost.placement;
    if (pl.kind === 'free') return { x: ghost.w.x, y: ghost.w.y, r: ghost.geo.kind === 'rack' ? 2 : toMm(ghost.geo.r), snapped: false };
    if (pl.kind !== 'mesh') return null;
    const P = nodeById.get(pl.parent)!;
    const a = toMm(P.geo.kind === 'internal' ? meshGeometry(ghost.geo, P.geo).centerDistance : meshGeometry(P.geo, ghost.geo).centerDistance);
    const sgn = ghost.geo.kind === 'internal' ? -1 : 1;
    const r = ghost.geo.kind === 'rack' ? 2 : toMm(ghost.geo.r);
    return { x: toMm(P.x) + sgn * a * Math.cos(pl.angle), y: toMm(P.y) + sgn * a * Math.sin(pl.angle), r, snapped: true };
  })();
  const onPointerUp = () => (drag.current = null);

  const b = box ?? fit();
  const unit = b.w / 100; // épaisseur de trait de référence (mm)

  // superpositions des engrènements
  const overlays = train.meshes.filter((m) => m.type === 'parallel' && nodeById.get(m.a)!.group === 0).flatMap((m) => {
    const A = nodeById.get(m.a)!;
    const B = nodeById.get(m.b)!;
    const pa = ps.filter((p) => p.nodeId === A.id);
    const pb = ps.filter((p) => p.nodeId === B.id);
    // planétaire : un engrènement par satellite (satellites côté a ou côté b)
    const pairs = pa.length > 1 ? pa.map((x) => ({ a: x, b: pb[0] })) : pb.map((x) => ({ a: pa[0], b: x }));
    return pairs.map(({ a: ap, b: bp }, j) => {
      const gamma = B.geo.kind === 'external' ? Math.atan2(bp.y - ap.y, bp.x - ap.x) : B.geo.kind === 'internal' ? Math.atan2(ap.y - bp.y, ap.x - bp.x) : m.gamma;
      // flanc en contact : la roue menante pousse avec son flanc avant
      const sA = Math.sign(A.ratio * omega) || 1;
      const sigma = (m.driver === A.id ? -sA : sA) as 1 | -1;
      const o = contactOverlay(A.geo, ap, ap.angle, B.geo, bp, m.geo, gamma, sigma);
      return { key: `${m.a}-${m.b}-${j}`, o, ap, bp, m, A, B };
    });
  });

  const selectedNode = selectedId ? nodeById.get(selectedId) : undefined;
  return (
    <div className="trainview">
      <div className="toolbar">
        <button onClick={() => setPlaying((p) => !p)}>{playing ? '⏸ Pause' : '▶ Lecture'}</button>
        <label className="slider">
          Ralenti ×{fmt(10 ** slow, 4)}
          <input type="range" min={-4} max={0} step={0.05} value={slow} onChange={(e) => setSlow(Number(e.target.value))} />
        </label>
        <span className="speed">
          Moteur : {fmt(toRpm(omega), 0)} tr/min → sortie : {train.linearOutput ? `${fmt(toMm(Math.abs(omega / train.ratio)), 1)} mm/s` : `${fmt(Math.abs(toRpm(omega / train.ratio)), 1)} tr/min`}
        </span>
        <button onClick={() => (mode === '2d' ? setBox(fit()) : setFitSignal((k) => k + 1))}>Recadrer</button>
        <span className="chips">
          <button className={mode === '2d' ? 'chip active' : 'chip'} onClick={() => setMode('2d')}>2D</button>
          <button className={mode === '3d' ? 'chip active' : 'chip'} onClick={() => setMode('3d')}>3D</button>
        </span>
      </div>
      {mode === '3d' ? (
        <>
          <div className="toolbar toggles">
            <CheckField label="Flasques" checked={show3d.plates} onChange={(v) => setShow3d({ ...show3d, plates: v })} />
            <CheckField label="Tiges et arbre moteur" checked={show3d.rods} onChange={(v) => setShow3d({ ...show3d, rods: v })} />
            <CheckField label="Moteur" checked={show3d.motor} onChange={(v) => setShow3d({ ...show3d, motor: v })} />
            <CheckField label="Couleur selon la résistance" checked={show3d.safety} onChange={(v) => setShow3d({ ...show3d, safety: v })} />
          </div>
          <View3D
            train={train}
            asm={computed.assembly}
            poses={allPoses}
            levels={new Map(computed.strength.map((x) => [x.node.id, x.level]))}
            show={show3d}
            selectedId={selectedId}
            onSelect={onSelect}
            fitSignal={fitSignal}
            movable={(id) => {
              if (train.mode !== 'chain') return undefined;
              const g = project.chain.gears.find((x) => x.gear.id === id);
              if (!g) return undefined;
              const d = shaftDrive(project.chain, id);
              const dg = d ? project.chain.gears.find((x) => x.gear.id === d) : undefined;
              const drive = dg && dg.placement.kind === 'mesh' ? { id: d!, parent: dg.placement.parent, inside: nodeById.get(d!)?.geo.kind === 'internal' } : undefined;
              return { axialOffset: g.axialOffset ?? 0, drive };
            }}
            onMove={(id, m) =>
              update((dr) => {
                const g = dr.chain.gears.find((x) => x.gear.id === id);
                if (!g) return;
                if (m.axialOffset !== undefined) g.axialOffset = Math.abs(m.axialOffset) < 1e-9 ? 0 : m.axialOffset;
                if (m.angle !== undefined && g.placement.kind === 'mesh') g.placement.angle = m.angle;
              })
            }
          />
          <p className="hint">
            Glisser : tourner autour · Maj + glisser ou clic droit : déplacer la vue · molette : zoom · clic : sélectionner · <b>glisser la roue sélectionnée</b> : le long de sa tige, ou autour de sa roue menante (la tige suit){(project.assembly?.freeRods?.length ?? 0) > 0 ? ' · glisser une tige libre (disque gris) : la déplacer' : ''}. Positions axiales et tiges : onglet Train, section « Montage 3D ».
            {selectedNode && ` Sélection : ${selectedNode.spec.name}, z = ${fmt(toMm(computed.assembly.placed[selectedNode.id]?.z ?? 0), 2)} mm.`}
          </p>
        </>
      ) : (
      <>
      <div className="toolbar toggles">
        <CheckField label="Cercles primitifs" checked={opts.pitch} onChange={(v) => setOpts({ ...opts, pitch: v })} />
        <CheckField label="Cercles de base" checked={opts.base} onChange={(v) => setOpts({ ...opts, base: v })} />
        <CheckField label="Ligne d'action" checked={opts.action} onChange={(v) => setOpts({ ...opts, action: v })} />
        <CheckField label="Points de contact" checked={opts.contacts} onChange={(v) => setOpts({ ...opts, contacts: v })} />
        <CheckField label="Entraxes" checked={opts.dims} onChange={(v) => setOpts({ ...opts, dims: v })} />
        <CheckField label="Encombrement" checked={opts.bbox} onChange={(v) => setOpts({ ...opts, bbox: v })} />
        <CheckField label="Couleur selon la résistance" checked={opts.safety} onChange={(v) => setOpts({ ...opts, safety: v })} />
      </div>
      {train.mode === 'chain' && (
        <div className="toolbar palette">
          <span className="muted small">Glisser dans la vue :</span>
          {PALETTE.map((it) => (
            <button
              key={it.kind}
              className={`chip ${pal?.kind === it.kind ? 'active' : ''}`}
              style={{ touchAction: 'none' }}
              onPointerDown={(e) => {
                e.preventDefault();
                (e.target as Element).releasePointerCapture?.(e.pointerId);
                setPal({ kind: it.kind, cx: e.clientX, cy: e.clientY });
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
      <svg
        ref={svgRef}
        className="scene"
        viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`}
        onWheel={onWheel}
        onPointerDown={(e) => onPointerDown(e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <g transform="scale(1,-1)" style={{ ['--u' as string]: `${unit}px` }}>
          {ps.map((p) => {
            const n = nodeById.get(p.nodeId)!;
            const st = strength.get(n.id);
            const col = opts.safety && st ? LEVEL_COLORS[st.level] : null;
            const sel = n.id === selectedId;
            return (
              <g
                key={p.key}
                transform={`translate(${toMm(p.x)} ${toMm(p.y)}) rotate(${(p.angle * 180) / Math.PI})`}
                className={`gear layer${Math.min(n.layer, 3)} ${sel ? 'selected' : ''}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onPointerDown(e, n.id);
                }}
              >
                <path d={paths.get(n.id)} fillRule="evenodd" style={col ? { fill: col.fill, stroke: col.stroke } : undefined} strokeWidth={unit * 0.15} />
                {n.geo.kind !== 'rack' && <circle r={unit * 0.4} className="center" />}
                {n.geo.kind !== 'rack' && <line x1={0} y1={0} x2={toMm(n.geo.kind === 'internal' ? n.geo.ra : n.geo.rf) * 0.8} y2={0} className="marker" strokeWidth={unit * 0.15} />}
              </g>
            );
          })}
          {opts.pitch && ps.map((p) => {
            const n = nodeById.get(p.nodeId)!;
            if (n.geo.kind === 'rack') {
              const L = toMm(n.geo.z * n.geo.pt);
              const c = Math.cos(n.rackAngle!), s = Math.sin(n.rackAngle!);
              return <line key={`pc${p.key}`} x1={toMm(p.x) - (L / 2) * c} y1={toMm(p.y) - (L / 2) * s} x2={toMm(p.x) + (L / 2) * c} y2={toMm(p.y) + (L / 2) * s} className="pitch" strokeWidth={unit * 0.12} />;
            }
            return <circle key={`pc${p.key}`} cx={toMm(p.x)} cy={toMm(p.y)} r={toMm(n.geo.r)} className="pitch" strokeWidth={unit * 0.12} />;
          })}
          {opts.base && ps.map((p) => {
            const n = nodeById.get(p.nodeId)!;
            return n.geo.kind === 'rack' ? null : <circle key={`bc${p.key}`} cx={toMm(p.x)} cy={toMm(p.y)} r={toMm(n.geo.rb)} className="base" strokeWidth={unit * 0.12} />;
          })}
          {overlays.map(({ key, o }) => (
            <g key={key}>
              {opts.action && <line x1={toMm(o.from.x)} y1={toMm(o.from.y)} x2={toMm(o.to.x)} y2={toMm(o.to.y)} className="action" strokeWidth={unit * 0.15} />}
              {opts.contacts && o.points.map((q, i) => <circle key={i} cx={toMm(q.x)} cy={toMm(q.y)} r={unit * 0.6} className="contact" />)}
            </g>
          ))}
          {(project.assembly?.freeRods ?? []).map((r) => (
            <circle
              key={`fr${r.id}`}
              cx={toMm(r.x)}
              cy={toMm(r.y)}
              r={toMm(computed.assembly.shafts.find((s) => s.id === r.id)?.radius ?? 1.5e-3)}
              className="freerod"
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.target as Element).setPointerCapture?.(e.pointerId);
                drag.current = { kind: 'rod', id: r.id };
              }}
            />
          ))}
          {ghostCenter && (
            <circle cx={ghostCenter.x} cy={ghostCenter.y} r={ghostCenter.r} className={`ghost ${ghostCenter.snapped ? 'snapped' : ''}`} strokeWidth={unit * 0.25} strokeDasharray={`${unit} ${unit / 2}`} />
          )}
          {opts.bbox && <rect x={bounds.minX} y={bounds.minY} width={bounds.maxX - bounds.minX} height={bounds.maxY - bounds.minY} className="bbox" strokeWidth={unit * 0.15} />}
        </g>
        {/* textes dans le repère SVG (non inversé) */}
        {opts.dims && overlays.filter((x, i, arr) => arr.findIndex((y) => y.m === x.m) === i).map(({ key, m, ap, bp, B }) => {
          const ax = toMm(ap.x), ay = -toMm(ap.y);
          const isRack = B.geo.kind === 'rack';
          const bx = isRack ? toMm(B.x) : toMm(bp.x), by = isRack ? -toMm(B.y) : -toMm(bp.y);
          return (
            <g key={`d${key}`} className="dim">
              <line x1={ax} y1={ay} x2={bx} y2={by} strokeWidth={unit * 0.12} strokeDasharray={`${unit} ${unit / 2}`} />
              <text x={(ax + bx) / 2} y={(ay + by) / 2 - unit} fontSize={unit * 2.4} textAnchor="middle">
                a = {fmt(toMm(m.geo.centerDistance), 2)} mm
              </text>
            </g>
          );
        })}
        {opts.bbox && (
          <g className="dim">
            <text x={(bounds.minX + bounds.maxX) / 2} y={-bounds.maxY - unit} fontSize={unit * 2.4} textAnchor="middle">
              {fmt(bounds.maxX - bounds.minX, 1)} × {fmt(bounds.maxY - bounds.minY, 1)} mm
            </text>
          </g>
        )}
        {ps.filter((p, i, arr) => arr.findIndex((q) => q.nodeId === p.nodeId) === i).map((p) => {
          const n = nodeById.get(p.nodeId)!;
          if (n.geo.kind === 'rack') return null;
          const r = n.geo.kind === 'internal' ? n.geo.rf + n.spec.rimWidth : n.geo.ra;
          const x = toMm(p.x);
          const y = -toMm(p.y) + toMm(r) + unit * 3;
          return (
            <text key={`t${p.key}`} x={x} y={y} fontSize={unit * 2.4} textAnchor="middle" className="label">
              {n.spec.name} ({n.geo.z} d.)
            </text>
          );
        })}
      </svg>
      <p className="hint">
        {hidden && <b>Les roues d'axes perpendiculaires (renvoi conique, vis sans fin) ne s'affichent qu'en 3D. </b>}
        Molette : zoom · glisser le fond : déplacer · {train.mode === 'chain' ? 'glisser une roue : la déplacer librement, elle s\'accroche quand elle arrive contre une autre roue (une roue à l\'écart ne tourne pas) · ' : ''}clic : sélectionner{(project.assembly?.freeRods?.length ?? 0) > 0 ? ' · glisser une tige libre (disque gris) : la déplacer' : ''}.
        {selectedNode && ` Sélection : ${selectedNode.spec.name}, ${fmt(Math.abs(toRpm(selectedNode.ratio * omega)), 1)} tr/min.`}
      </p>
      </>
      )}
    </div>
  );
}
