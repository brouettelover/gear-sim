/**
 * Onglet 6 : export STL / SVG / DXF de chaque pièce et fiche récapitulative.
 */
import { assemblyMesh, partMesh } from '../core/assembly';
import { extrudePrism, meshToStl, shapeToDxf, shapeToSvg } from '../core/export';
import { solidMesh } from '../core/gearkinds';
import type { Computed, Project } from '../core/project';
import { buildReport } from '../core/report';
import type { TrainNode } from '../core/train';
import { fmt, toMm } from '../core/units';
import { download } from './download';
import { Section } from './fields';

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'piece';

function exportStl(n: TrainNode) {
  const mesh = solidMesh(n.solid);
  download(`${slug(n.spec.name)}.stl`, meshToStl(mesh, n.spec.name), 'model/stl');
}

export function ExportPanel({ project, computed }: { project: Project; computed: Computed }) {
  const nodes = computed.train.nodes;
  const asm = computed.assembly;
  const fused = new Set(asm.parts.filter((p) => p.nodeIds.length > 1).flatMap((p) => p.nodeIds));
  const report = () => buildReport(project, computed);
  return (
    <div>
      <Section title="Pièces">
        <table className="table">
          <thead>
            <tr>
              <th>Pièce</th>
              <th>Dimensions</th>
              <th>Fichiers</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.id}>
                <td>
                  {n.spec.name}
                  {n.count > 1 ? <b> ×{n.count}</b> : null}
                  {fused.has(n.id) && <div className="muted small">imprimée d'un seul tenant avec les autres roues de sa tige (voir Montage sur tiges)</div>}
                </td>
                <td className="muted">
                  {n.geo.kind === 'rack' ? `L ${fmt(toMm(n.geo.z * n.geo.pt), 1)} mm` : `Ø ${fmt(toMm(2 * (n.geo.kind === 'internal' ? n.geo.rf + n.spec.rimWidth : n.geo.ra)), 2)} mm`} × {fmt(toMm(n.spec.faceWidth), 1)} mm
                </td>
                <td className="row">
                  <button className="small" onClick={() => exportStl(n)}>STL</button>
                  <button className="small" onClick={() => download(`${slug(n.spec.name)}.svg`, shapeToSvg(n.shape, n.spec.name), 'image/svg+xml')}>SVG</button>
                  <button className="small" onClick={() => download(`${slug(n.spec.name)}.dxf`, shapeToDxf(n.shape), 'application/dxf')}>DXF</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <button
            onClick={() =>
              nodes.filter((n) => !fused.has(n.id)).forEach((n, i) => setTimeout(() => exportStl(n), i * 300))
            }
          >
            Télécharger tous les STL des roues séparées
          </button>
        </div>
        <p className="muted small">
          Fichiers en millimètres. Les STL sont extrudés selon la largeur ; les dentures hélicoïdales sont tordues de b·tan β / r, le chevron en deux moitiés opposées.
          Les jeux d'impression (jeu au flanc, jeu radial, compensation des alésages) sont déjà appliqués. Le porte-satellites n'est pas généré.
        </p>
      </Section>

      {asm.shafts.length > 0 && (
        <Section title="Montage sur tiges">
          <table className="table">
            <thead>
              <tr>
                <th>Pièce</th>
                <th>Détail</th>
                <th>Fichiers</th>
              </tr>
            </thead>
            <tbody>
              {asm.parts.filter((p) => p.nodeIds.length > 1).map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="muted">roues fusionnées{p.collars.length ? ', entretoise' : ''}</td>
                  <td className="row">
                    <button className="small" onClick={() => download(`${slug(p.name)}.stl`, meshToStl(partMesh(p, computed.train, asm), p.name), 'model/stl')}>STL</button>
                  </td>
                </tr>
              ))}
              {asm.plates.map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td className="muted">{fmt(toMm(p.width), 1)} × {fmt(toMm(p.height), 1)} × {fmt(toMm(p.thickness), 1)} mm, {p.shape.holes.length} trou(s)</td>
                  <td className="row">
                    <button className="small" onClick={() => download(`${slug(p.name)}.stl`, meshToStl(extrudePrism(p.shape, p.thickness), p.name), 'model/stl')}>STL</button>
                    <button className="small" onClick={() => download(`${slug(p.name)}.svg`, shapeToSvg(p.shape, p.name), 'image/svg+xml')}>SVG</button>
                    <button className="small" onClick={() => download(`${slug(p.name)}.dxf`, shapeToDxf(p.shape), 'application/dxf')}>DXF</button>
                  </td>
                </tr>
              ))}
              {asm.shafts.filter((s) => s.kind === 'rod').map((s) => (
                <tr key={s.id}>
                  <td>Tige de « {nodes.find((n) => n.id === s.rootGearId)?.spec.name} »</td>
                  <td className="muted">Ø {fmt(toMm(2 * s.radius), 1)} mm, à couper à {fmt(toMm(s.zTo - s.zFrom), 1)} mm</td>
                  <td className="muted">à acheter</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <button onClick={() => download(`${slug(project.name)}-ensemble.stl`, meshToStl(assemblyMesh(computed.train, asm), 'ensemble'), 'model/stl')}>STL de l'ensemble monté (contrôle)</button>
          </div>
          <p className="muted small">
            Repère commun : z = 0 sur la face intérieure du flasque inférieur, moteur fixé dessous. Les pièces fusionnées s'impriment à plat, la plus grande roue en bas si possible
            (sinon retournez la pièce dans le trancheur). L'ensemble monté sert à vérifier l'assemblage, pas à l'impression.
          </p>
          {asm.notes.map((n) => <p key={n} className="muted small">{n}</p>)}
        </Section>
      )}

      <Section title="Fiche récapitulative">
        <p>Paramètres, rapport, performances, coefficients de sécurité, réglages d'impression conseillés et hypothèses du modèle.</p>
        <div className="row">
          <button className="primary" onClick={() => {
            const w = window.open('', '_blank');
            if (w) {
              w.document.write(report());
              w.document.close();
            }
          }}>
            Ouvrir la fiche (imprimable)
          </button>
          <button onClick={() => download(`${slug(project.name)}-fiche.html`, report(), 'text/html')}>Télécharger la fiche (HTML)</button>
        </div>
      </Section>
    </div>
  );
}
