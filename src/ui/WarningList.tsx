import type { Warning } from '../core/types';

const ICON = { error: '⛔', warning: '⚠️', info: 'ℹ️' } as const;

/** Liste des avertissements du projet, les plus graves d'abord. */
export function WarningList({ warnings, reminders }: { warnings: Warning[]; reminders: string[] }) {
  const order = { error: 0, warning: 1, info: 2 };
  const sorted = [...warnings].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <div className="warnings">
      <h3>Vérifications {sorted.length === 0 && <span className="ok-badge">aucun problème détecté</span>}</h3>
      <ul>
        {sorted.map((w, i) => (
          <li key={i} className={w.severity}>
            <span aria-hidden>{ICON[w.severity]}</span> {w.message}
          </li>
        ))}
        {reminders.map((r, i) => (
          <li key={`r${i}`} className="reminder">
            <span aria-hidden>💡</span> {r}
          </li>
        ))}
      </ul>
    </div>
  );
}
