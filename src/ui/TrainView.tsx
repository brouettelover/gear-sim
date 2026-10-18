/**
 * Vue animée du train, en 2D (SVG) ou en 3D (WebGL, voir View3D).
 * 2D : engrènement synchronisé sur la vitesse simulée (avec ralenti),
 * zoom (molette), déplacement (glisser le fond), placement des roues (glisser une roue),
 * superpositions : cercles primitifs, ligne d'action, points de contact, entraxes, encombrement.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Computed, Project } from '../core/project';
import { contactOverlay } from '../core/contact';
import { poses, type ChainSpec, type TrainNode } from '../core/train';
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
  const drag = useRef<{ kind: 'pan'; sx: number; sy: number; box: Box } | { kind: 'gear'; id: string } | { kind: 'rod'; id: string } | null>(null);

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
      if (drive) {
        drag.current = { kind: 'gear', id: drive };
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
    const tg = project.chain.gears.find((x) => x.gear.id === d.id);
    if (!tg || tg.placement.kind !== 'mesh') return;
    const parent = nodeById.get(tg.placement.parent);
    const self = nodeById.get(d.id);
    if (!parent || !self) return;
    const w = toWorld(e);
    const px = toMm(parent.x), py = toMm(parent.y);
    // couronne fille : son centre est à l'opposé du point primitif
    const ang = self.geo.kind === 'internal' ? Math.atan2(py - w.y, px - w.x) : Math.atan2(w.y - py, w.x - px);
    update((dr) => {
      const g = dr.chain.gears.find((x) => x.gear.id === d.id);
      if (g && g.placement.kind === 'mesh') g.placement.angle = Math.round(ang / (Math.PI / 180)) * (Math.PI / 180);
    });
  };
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
        Molette : zoom · glisser le fond : déplacer · {train.mode === 'chain' ? 'glisser une roue : déplacer sa tige autour de la roue menante · ' : ''}clic : sélectionner{(project.assembly?.freeRods?.length ?? 0) > 0 ? ' · glisser une tige libre (disque gris) : la déplacer' : ''}.
        {selectedNode && ` Sélection : ${selectedNode.spec.name}, ${fmt(Math.abs(toRpm(selectedNode.ratio * omega)), 1)} tr/min.`}
      </p>
      </>
      )}
    </div>
  );
}
