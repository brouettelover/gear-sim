/**
 * Application : état du projet (sauvegardé dans localStorage), onglets, vue du train.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { computeProject, defaultProject, parseProject, serializeProject, type Project } from '../core/project';
import type { GearSpec } from '../core/types';
import { GearEditor } from './GearEditor';
import { TrainPanel } from './TrainPanel';
import { MotorPanel } from './MotorPanel';
import { SimPanel } from './SimPanel';
import { StrengthPanel } from './StrengthPanel';
import { ExportPanel } from './ExportPanel';
import { Assumptions } from './Assumptions';
import { TrainView } from './TrainView';
import { WarningList } from './WarningList';
import { download } from './download';

const STORAGE_KEY = 'gear-sim:project';

type Tab = 'gear' | 'train' | 'motor' | 'sim' | 'strength' | 'export' | 'assumptions';
const TABS: { id: Tab; label: string }[] = [
  { id: 'gear', label: '1. Engrenage' },
  { id: 'train', label: '2. Train' },
  { id: 'motor', label: '3. Moteur et charge' },
  { id: 'sim', label: '4. Simulation' },
  { id: 'strength', label: '5. Résistance' },
  { id: 'export', label: '6. Export' },
  { id: 'assumptions', label: 'Hypothèses' },
];

function loadInitial(): Project {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) return parseProject(s);
  } catch {
    /* projet corrompu ou stockage indisponible : on repart du projet par défaut */
  }
  return defaultProject();
}

/** Liste de toutes les roues éditables du projet, selon le mode. */
export function projectGears(p: Project): GearSpec[] {
  return p.mode === 'planetary' ? [p.planetary.sun, p.planetary.planet, p.planetary.ring] : p.chain.gears.map((g) => g.gear);
}

export type Updater = (fn: (draft: Project) => void) => void;

export function App() {
  const [project, setProject] = useState<Project>(loadInitial);
  const [tab, setTab] = useState<Tab>('gear');
  const [confirmReset, setConfirmReset] = useState(false);
  const [importError, setImportError] = useState('');
  const [selected, setSelected] = useState<string>(() => projectGears(project)[0]?.id ?? '');
  const fileRef = useRef<HTMLInputElement>(null);

  const update: Updater = (fn) =>
    setProject((p) => {
      const d = structuredClone(p);
      fn(d);
      return d;
    });

  // sauvegarde automatique (différée pour ne pas écrire à chaque frappe)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, serializeProject(project));
      } catch {
        /* stockage plein ou interdit : la sauvegarde JSON reste possible */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [project]);

  const computed = useMemo(() => computeProject(project), [project]);
  const gears = projectGears(project);
  const selectedId = gears.some((g) => g.id === selected) ? selected : gears[0]?.id;

  const importFile = async (f: File) => {
    try {
      const p = parseProject(await f.text());
      setProject(p);
      setSelected(projectGears(p)[0]?.id ?? '');
      setImportError('');
    } catch (e) {
      setImportError(`Import impossible : ${(e as Error).message}`);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          Gear Sim <span className="sub">engrenages imprimés en 3D</span>
        </h1>
        <input className="project-name" value={project.name} onChange={(e) => update((d) => void (d.name = e.target.value))} aria-label="Nom du projet" />
        <div className="actions">
          <button onClick={() => download(`${project.name || 'projet'}.json`, serializeProject(project), 'application/json')}>Exporter le projet (JSON)</button>
          <button onClick={() => fileRef.current?.click()}>Importer…</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
          {/* confirmation en deux clics (les boîtes de dialogue natives ne sont pas toujours disponibles) */}
          <button
            className={confirmReset ? 'danger' : 'ghost'}
            onBlur={() => setConfirmReset(false)}
            onClick={() => {
              if (!confirmReset) return setConfirmReset(true);
              const p = defaultProject();
              setProject(p);
              setSelected(projectGears(p)[0].id);
              setConfirmReset(false);
            }}
          >
            {confirmReset ? 'Confirmer : effacer le projet actuel' : 'Nouveau'}
          </button>
        </div>
      </header>
      {importError && <div className="banner error-text">{importError}</div>}
      <div className="banner">
        Modèle simplifié : rendement constant, dents indéformables, contrainte de Lewis sans usure ni fatigue détaillée, moteur à paramètres constants.
        Les résultats sont des ordres de grandeur. <button className="link" onClick={() => setTab('assumptions')}>Voir toutes les hypothèses</button>
      </div>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="layout">
        <div className="panel">
          {tab === 'gear' && <GearEditor project={project} computed={computed} update={update} selectedId={selectedId} onSelect={setSelected} />}
          {tab === 'train' && <TrainPanel project={project} computed={computed} update={update} selectedId={selectedId} onSelect={setSelected} />}
          {tab === 'motor' && <MotorPanel project={project} computed={computed} update={update} />}
          {tab === 'sim' && <SimPanel project={project} computed={computed} update={update} />}
          {tab === 'strength' && <StrengthPanel project={project} computed={computed} update={update} onSelect={setSelected} />}
          {tab === 'export' && <ExportPanel project={project} computed={computed} />}
          {tab === 'assumptions' && <Assumptions />}
        </div>
        <div className="viewcol">
          <TrainView project={project} computed={computed} update={update} selectedId={selectedId} onSelect={setSelected} />
          <WarningList warnings={computed.warnings} reminders={computed.reminders} />
        </div>
      </main>
    </div>
  );
}
