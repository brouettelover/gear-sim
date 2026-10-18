/**
 * Fiche récapitulative (HTML imprimable) : paramètres, rapport, performances,
 * coefficients de sécurité, réglages d'impression conseillés et hypothèses.
 */
import { SIMPLIFICATIONS } from './assumptions';
import { printAdvice, type Computed, type Project } from './project';
import { describeRatio, directionLabel } from './train';
import { DEG, MPA, fmt, toMm, toNmm, toRpm } from './units';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const TYPE: Record<string, string> = { spur: 'droit', helical: 'hélicoïdal', herringbone: 'chevron', rack: 'crémaillère', internal: 'couronne intérieure' };
const BORE: Record<string, string> = { none: 'aucun', round: 'rond', d: 'en D', hex: 'hexagonal' };

export function buildReport(p: Project, c: Computed, date = new Date()): string {
  const s = c.steady;
  const t = c.train;
  const rows = (cells: string[][]) => cells.map((r) => `<tr>${r.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('');

  const gearRows = t.nodes.map((n) => {
    const g = n.geo;
    const bore = n.spec.bore.type === 'none' || g.kind !== 'external' ? '—' : `${BORE[n.spec.bore.type]} ${fmt(toMm(n.spec.bore.diameter), 2)}${n.spec.bore.type === 'd' ? ` / ${fmt(toMm(n.spec.bore.flat), 2)}` : ''} mm`;
    return [
      esc(n.spec.name) + (n.count > 1 ? ` (×${n.count})` : ''), TYPE[n.spec.type], String(g.z), fmt(toMm(g.mn), 3),
      fmt(g.alphaN / DEG, 1) + '°', fmt(toMm(n.spec.faceWidth), 2), fmt(g.x, 3),
      g.beta ? fmt(g.beta / DEG, 1) + '°' : '—',
      g.kind === 'rack' ? '—' : fmt(toMm(2 * g.r), 3), g.kind === 'rack' ? '—' : fmt(toMm(2 * g.ra), 3), g.kind === 'rack' ? '—' : fmt(toMm(2 * g.rf), 3),
      bore, esc(n.material.name), fmt(n.mass * 1000, 1),
    ];
  });
  const meshRows = t.meshes.map((m) => {
    const a = t.nodes.find((n) => n.id === m.a)!.spec.name;
    const b = t.nodes.find((n) => n.id === m.b)!.spec.name;
    return [`${esc(a)} / ${esc(b)}`, fmt(toMm(m.geo.centerDistance), 3) + ' mm', fmt(m.geo.alphaW / DEG, 3) + '°', fmt(m.geo.contactRatio, 3), m.geo.overlapRatio ? fmt(m.geo.overlapRatio, 3) : '—'];
  });
  const safetyRows = c.strength.map((x) => {
    const a = printAdvice(x.node, p.print, x.operating.safety);
    return [esc(x.node.spec.name), fmt(x.operating.ft, 2) + ' N', fmt(x.operating.stress / MPA, 2) + ' MPa', `<b class="${x.level}">${fmt(x.operating.safety, 2)}</b>`, `<b class="${x.stallLevel}">${fmt(x.stall.safety, 2)}</b>`, a.orientation, String(a.walls), `${a.infill} %`, `≤ ${fmt(toMm(a.layer), 2)} mm`];
  });
  const speed = t.linearOutput ? `${fmt(toMm(Math.abs(s.omegaMotor / t.ratio)), 2)} mm/s` : `${fmt(toRpm(s.omegaOut), 2)} tr/min`;

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Fiche – ${esc(p.name)}</title>
<style>
body{font:13px/1.45 system-ui,sans-serif;margin:24px;color:#1d232b}
h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;margin:22px 0 6px;border-bottom:1px solid #ccd;padding-bottom:3px}
table{border-collapse:collapse;width:100%;margin:4px 0} td,th{border:1px solid #d4d8de;padding:3px 6px;text-align:left;vertical-align:top}
th{background:#f1f3f6} .ok{color:#1e8a4c} .marginal{color:#c27a00} .danger{color:#c0392b} .muted{color:#667}
ul{margin:4px 0;padding-left:18px} @media print{body{margin:10mm}}
</style></head><body>
<h1>${esc(p.name)}</h1>
<div class="muted">Fiche générée par Gear Sim le ${date.toLocaleDateString('fr-FR')} · ${t.mode === 'planetary' ? 'train planétaire' : 'train simple / composé'}</div>

<h2>Engrenages</h2>
<table><tr><th>Roue</th><th>Type</th><th>z</th><th>m (mm)</th><th>α</th><th>b (mm)</th><th>x</th><th>β</th><th>d</th><th>da</th><th>df</th><th>Alésage</th><th>Matériau</th><th>Masse (g)</th></tr>${rows(gearRows)}</table>
<p class="muted">Impression : jeu au flanc ${fmt(toMm(p.print.backlash), 2)} mm, jeu radial c* = ${fmt(p.print.clearanceCoef, 2)}, compensation des alésages +${fmt(toMm(p.print.boreTolerance), 2)} mm, buse ${fmt(toMm(p.print.nozzle), 2)} mm.</p>

<h2>Engrènements</h2>
<table><tr><th>Couple</th><th>Entraxe</th><th>αw</th><th>εα</th><th>εβ</th></tr>${rows(meshRows)}</table>

<h2>Rapport et performances</h2>
<table>${rows([
    ['Rapport global', describeRatio(t.ratio) + ` (${directionLabel(1 / t.ratio)})`],
    ['Rendement du train (estimé)', fmt(t.efficiency * 100, 1) + ' %'],
    ['Moteur', `${esc(p.motor.name)} – ${fmt(p.motor.voltage, 1)} V, ${fmt(toRpm(p.motor.noLoadSpeed), 0)} tr/min à vide, ${fmt(toNmm(p.motor.stallTorque), 1)} N·mm au blocage`],
    ['Vitesse de sortie', s.stalled ? 'moteur calé' : speed],
    ['Couple de sortie', fmt(toNmm(s.outTorque), 2) + ' N·mm'],
    ['Courant', fmt(s.current, 3) + ' A'],
    ['Puissance électrique / mécanique', `${fmt(s.electricalPower, 3)} W / ${fmt(s.outputPower, 3)} W (rendement global ${fmt(s.efficiency * 100, 1)} %)`],
    ['Marge avant blocage', fmt(s.stallMargin * 100, 0) + ' %'],
  ])}</table>

<h2>Résistance (Lewis) et réglages d'impression conseillés</h2>
<table><tr><th>Roue</th><th>Ft</th><th>σ</th><th>n service</th><th>n blocage</th><th>Orientation</th><th>Parois</th><th>Remplissage</th><th>Couche</th></tr>${rows(safetyRows)}</table>
<p class="muted">Vert n ≥ 2, orange 1,25–2, rouge &lt; 1,25.</p>

<h2>Vérifications</h2>
<ul>${c.warnings.map((w) => `<li class="${w.severity === 'error' ? 'danger' : w.severity === 'warning' ? 'marginal' : ''}">${esc(w.message)}</li>`).join('') || '<li>Aucun problème détecté.</li>'}
${c.reminders.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>

<h2>Hypothèses et simplifications</h2>
${SIMPLIFICATIONS.map((g) => `<b>${g.title}</b><ul>${g.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}
</body></html>`;
}
