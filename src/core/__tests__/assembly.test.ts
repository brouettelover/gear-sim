import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSEMBLY, analyzeAssembly, applyRodBores, assemblyMesh, freeMeshAngle, partMesh, shaftOf, suggestMeshGear, type AssemblySpec } from '../assembly';
import { extrudeShape, meshVolume } from '../export';
import { DEFAULT_MATERIALS } from '../materials';
import { analyzeChain, gearLoads, type ChainSpec } from '../train';
import { MM } from '../units';
import { IDEAL_PRINT, spec } from './testUtils';

const A: AssemblySpec = { ...DEFAULT_ASSEMBLY };
const build = (c: ChainSpec, a: AssemblySpec = A) => {
  const rods = applyRodBores(c, a);
  const train = analyzeChain(rods.chain, IDEAL_PRINT, DEFAULT_MATERIALS, 0.9);
  return { train, asm: analyzeAssembly(train, rods.chain, a, IDEAL_PRINT, rods.ids), chain: rods.chain };
};
const errors = (w: { severity: string; message: string }[]) => w.filter((x) => x.severity === 'error').map((x) => x.message);

const compound: ChainSpec = {
  gears: [
    { gear: spec({ id: 'm', teeth: 10, profileShift: 0.5 }), placement: { kind: 'root' } },
    { gear: spec({ id: 'b1', teeth: 40 }), placement: { kind: 'mesh', parent: 'm', angle: 0 } },
    { gear: spec({ id: 'p2', teeth: 10, profileShift: 0.5 }), placement: { kind: 'coaxial', parent: 'b1' } },
    { gear: spec({ id: 'b2', teeth: 40 }), placement: { kind: 'mesh', parent: 'p2', angle: Math.PI / 2 } },
  ],
  outputId: 'b2',
};

describe('montage sur tiges', () => {
  const { asm, chain } = build(compound);
  it('regroupe les roues coaxiales sur un même arbre', () => {
    const s = shaftOf(compound);
    expect(s.get('p2')).toBe('b1');
    expect(s.get('b2')).toBe('b2');
    expect(asm.shafts.map((x) => x.kind).sort()).toEqual(['motor', 'rod', 'rod']);
  });
  it('positions axiales : même plan pour un engrènement, plan suivant + jeu pour une roue coaxiale', () => {
    expect(asm.placed.m.z).toBeCloseTo(A.plateGap, 12);
    expect(asm.placed.b1.z).toBeCloseTo(A.plateGap, 12);
    expect(asm.placed.p2.z).toBeCloseTo(A.plateGap + 5 * MM + A.layerGap, 12);
    expect(asm.placed.b2.z).toBeCloseTo(asm.placed.p2.z, 12);
    expect(asm.innerHeight).toBeCloseTo(asm.placed.b2.z + 5 * MM + A.plateGap, 12);
  });
  it('train composé bien placé : ni collision ni tige touchée', () => {
    expect(errors(asm.warnings)).toEqual([]);
  });
  it('tiges et flasques : longueur = hauteur intérieure + 2 flasques, un trou par tige (+ moteur en bas)', () => {
    const rod = asm.shafts.find((s) => s.kind === 'rod')!;
    expect(rod.zTo - rod.zFrom).toBeCloseTo(asm.innerHeight + 2 * A.plateThickness, 12);
    expect(asm.plates[0].shape.holes).toHaveLength(3);
    expect(asm.plates[1].shape.holes).toHaveLength(2);
  });
  it('alésage imposé par la tige sauf sur l\'arbre moteur', () => {
    const g = (id: string) => chain.gears.find((x) => x.gear.id === id)!.gear;
    expect(g('b1').bore).toEqual({ type: 'round', diameter: A.rodDiameter + A.runningClearance, flat: 0 });
    expect(g('m').bore.type).toBe('none');
    expect(asm.rodGearIds.sort()).toEqual(['b1', 'b2', 'p2']);
  });
  it('tige fixe : les roues d\'un même arbre forment une seule pièce avec une entretoise', () => {
    const part = asm.parts.find((p) => p.nodeIds.length === 2)!;
    expect(part.nodeIds).toEqual(['b1', 'p2']);
    expect(part.collars).toHaveLength(1);
    expect(part.collars[0].h).toBeCloseTo(A.layerGap, 12);
    expect(asm.parts).toHaveLength(3);
  });
  it('tige tournante : pièces séparées, alésage serré', () => {
    const r = build(compound, { ...A, rodMode: 'rotating' });
    expect(r.asm.parts).toHaveLength(4);
    expect(r.chain.gears[1].gear.bore.diameter).toBeCloseTo(A.rodDiameter, 12);
  });
  it('le décalage axial d\'une roue se propage à celles qui en dépendent', () => {
    const c = structuredClone(compound);
    c.gears[1].axialOffset = 2 * MM;
    c.gears[0].axialOffset = 2 * MM;
    const r = build(c);
    expect(r.asm.placed.b1.z).toBeCloseTo(asm.placed.b1.z + 4 * MM, 12);
    expect(r.asm.placed.b2.z).toBeCloseTo(asm.placed.b2.z + 4 * MM, 12);
  });
});

describe('vérifications 3D', () => {
  it('collision entre roues dont les plans se recouvrent', () => {
    const { asm } = build({
      gears: [
        { gear: spec({ id: 'a', teeth: 20 }), placement: { kind: 'root' } },
        { gear: spec({ id: 'b', teeth: 20 }), placement: { kind: 'mesh', parent: 'a', angle: 0 } },
        { gear: spec({ id: 'c', teeth: 20 }), placement: { kind: 'mesh', parent: 'b', angle: Math.PI + 0.3 } },
      ],
      outputId: 'c',
    });
    expect(asm.warnings.some((w) => w.message.startsWith('Collision'))).toBe(true);
  });
  it('prise axiale partielle : avertissement et largeur réduite pour la résistance', () => {
    const c: ChainSpec = {
      gears: [
        { gear: spec({ id: 'a', teeth: 20 }), placement: { kind: 'root' } },
        { gear: spec({ id: 'b', teeth: 20 }), placement: { kind: 'mesh', parent: 'a', angle: 0 }, axialOffset: 2 * MM },
      ],
      outputId: 'b',
    };
    const { asm, train } = build(c);
    expect(asm.meshOverlap['a|b']).toBeCloseTo(3 * MM, 12);
    expect(asm.warnings.some((w) => w.message.includes('prise axiale partielle'))).toBe(true);
    const loads = gearLoads(train, 0.01, 10, 0.9, asm.meshOverlap);
    expect(loads.find((l) => l.nodeId === 'a')!.width).toBeCloseTo(3 * MM, 12);
  });
  it('plans disjoints : l\'engrènement est impossible', () => {
    const { asm } = build({
      gears: [
        { gear: spec({ id: 'a', teeth: 20 }), placement: { kind: 'root' } },
        { gear: spec({ id: 'b', teeth: 20 }), placement: { kind: 'mesh', parent: 'a', angle: 0 }, axialOffset: 6 * MM },
      ],
      outputId: 'b',
    });
    expect(errors(asm.warnings).some((m) => m.includes('ne sont pas dans le même plan'))).toBe(true);
  });
  it('une grande roue sur l\'arbre moteur touche la tige voisine', () => {
    const { asm } = build({
      gears: [
        { gear: spec({ id: 'a', teeth: 10, profileShift: 0.5 }), placement: { kind: 'root' } },
        { gear: spec({ id: 'b', teeth: 40 }), placement: { kind: 'mesh', parent: 'a', angle: 0 } },
        { gear: spec({ id: 'c', teeth: 50 }), placement: { kind: 'coaxial', parent: 'a' } },
      ],
      outputId: 'b',
    });
    expect(errors(asm.warnings).some((m) => m.includes('touche la tige'))).toBe(true);
    // et elle dépasse l'arbre moteur (10 mm − 3 mm de flasque)
    expect(asm.warnings.some((w) => w.message.includes('dépasse le bout de l\'arbre moteur'))).toBe(true);
  });
  it('roues d\'arbres différents trop proches axialement : frottement signalé', () => {
    const { asm } = build({
      gears: [
        { gear: spec({ id: 'a', teeth: 10, profileShift: 0.5 }), placement: { kind: 'root' } },
        { gear: spec({ id: 'b', teeth: 40 }), placement: { kind: 'mesh', parent: 'a', angle: 0 } },
        { gear: spec({ id: 'p', teeth: 10, profileShift: 0.5 }), placement: { kind: 'coaxial', parent: 'b' } },
        { gear: spec({ id: 'c', teeth: 40 }), placement: { kind: 'mesh', parent: 'p', angle: Math.PI / 2 } },
      ],
      outputId: 'c',
    }, { ...A, layerGap: 0.1 * MM });
    expect(asm.warnings.some((w) => w.message.includes('risque de frottement'))).toBe(true);
  });
});

describe('pièces du montage', () => {
  it('pièce fusionnée : volume = roues + entretoise', () => {
    const { train, asm } = build(compound);
    const part = asm.parts.find((p) => p.nodeIds.length === 2)!;
    const vGears = part.nodeIds.reduce((v, id) => {
      const n = train.nodes.find((x) => x.id === id)!;
      return v + meshVolume(extrudeShape(n.shape, n.spec, n.geo));
    }, 0);
    const c = part.collars[0];
    const vCollar = Math.PI * (c.r ** 2 - c.bore ** 2) * c.h * 1e9;
    // les disques sont des polygones à 64 côtés : écart < 0,5 % sur l'entretoise
    expect(meshVolume(partMesh(part, train, asm))).toBeCloseTo(vGears + vCollar, -1);
    expect(meshVolume(partMesh(part, train, asm))).toBeGreaterThan(vGears);
  });
  it('ensemble monté : maillage orienté (volume positif)', () => {
    const { train, asm } = build(compound);
    expect(meshVolume(assemblyMesh(train, asm))).toBeGreaterThan(0);
  });
});

describe('placement automatique', () => {
  const base: ChainSpec = {
    gears: [
      { gear: spec({ id: 'a', teeth: 14, profileShift: 0.2 }), placement: { kind: 'root' } },
      { gear: spec({ id: 'b', teeth: 42 }), placement: { kind: 'mesh', parent: 'a', angle: 0 } },
      { gear: spec({ id: 'p', teeth: 14, profileShift: 0.2 }), placement: { kind: 'coaxial', parent: 'b' } },
    ],
    outputId: 'p',
  };
  const { train, asm } = build(base);
  it('une roue trop petite aurait sa tige dans la grande roue de l\'arbre menant, quel que soit l\'angle', () => {
    expect(freeMeshAngle(train, asm, 'p', spec({ id: 'c', teeth: 30 }), IDEAL_PRINT, A.rodDiameter / 2, 0).free).toBe(false);
  });
  it('on agrandit alors la roue jusqu\'à un placement sans collision', () => {
    const child = spec({ id: 'c', teeth: 30 });
    const sug = suggestMeshGear(train, asm, 'p', child, IDEAL_PRINT, A.rodDiameter / 2, 0);
    expect(sug.teeth).toBeGreaterThan(30);
    const r = build({ ...base, gears: [...base.gears, { gear: { ...child, teeth: sug.teeth }, placement: { kind: 'mesh', parent: 'p', angle: sug.angle } }], outputId: 'c' });
    expect(errors(r.asm.warnings)).toEqual([]);
  });
  it('sans obstacle, la direction préférée est gardée', () => {
    expect(freeMeshAngle(train, asm, 'a', spec({ id: 'c', teeth: 20 }), IDEAL_PRINT, A.rodDiameter / 2, Math.PI)).toEqual({ angle: Math.PI, free: true });
  });
});
