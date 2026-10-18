import { SIMPLIFICATIONS } from '../core/assumptions';
import { Section } from './fields';

/** Onglet "Hypothèses" : ce que le modèle ne prend pas en compte. */
export function Assumptions() {
  return (
    <div>
      <p>
        Ces calculs servent à dimensionner et à comparer des solutions, pas à garantir une durée de vie. Voici les simplifications retenues,
        pour ne pas surestimer leur précision.
      </p>
      {SIMPLIFICATIONS.map((g) => (
        <Section key={g.title} title={g.title}>
          <ul className="reminders">
            {g.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}
