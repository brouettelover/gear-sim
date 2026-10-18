/**
 * Onglet 6 : export STL / SVG / DXF de chaque pièce et fiche récapitulative.
 */
import { extrudeShape, meshToStl, shapeToDxf, shapeToSvg } from '../core/export';
import type { Computed, Project } from '../core/project';
import { buildReport } from '../core/report';
import type { TrainNode } from '../core/train';
import { fmt, toMm } from '../core/units';
import { download } from './download';
import { Section } from './fields';

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'piece';

function exportStl(n: TrainNode) {
  const mesh = extrudeShape(n.shape, n.spec, n.geo);
  download(`${slug(n.spec.name)}.stl`, meshToStl(mesh, n.spec.name), 'model/stl');
}

export function ExportPanel({ project, computed }: { project: Project; computed: Computed }) {
  const nodes = computed.train.nodes;
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
              nodes.forEach((n, i) => setTimeout(() => exportStl(n), i * 300))
            }
          >
            Télécharger tous les STL
          </button>
        </div>
        <p className="muted small">
          Fichiers en millimètres. Les STL sont extrudés selon la largeur ; les dentures hélicoïdales sont tordues de b·tan β / r, le chevron en deux moitiés opposées.
          Les jeux d'impression (jeu au flanc, jeu radial, compensation des alésages) sont déjà appliqués. Le porte-satellites n'est pas généré.
        </p>
      </Section>

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
