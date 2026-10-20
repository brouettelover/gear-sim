/**
 * Champs de saisie : la valeur est stockée en SI, affichée dans l'unité choisie
 * (facteur = valeur SI d'une unité affichée, ex. MM pour des millimètres).
 * La virgule décimale est acceptée.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { fmt } from '../core/units';

interface NumProps {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  /** valeur SI d'une unité affichée */
  factor?: number;
  unit?: string;
  digits?: number;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  hint?: string;
  disabled?: boolean;
}

export function NumField({ label, value, onChange, factor = 1, unit, digits = 3, min, max, step, integer, hint, disabled }: NumProps) {
  const id = useId();
  const shown = value / factor;
  const [text, setText] = useState(() => fmt(shown, digits));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmt(shown, digits));
  }, [shown, digits, focused]);
  const commit = (s: string) => {
    let v = Number(s.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(v)) return false;
    if (integer) v = Math.round(v);
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onChange(v * factor);
    return true;
  };
  return (
    <label className="field" htmlFor={id} title={hint}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setText(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => {
            setFocused(false);
            setText(fmt(value / factor, digits));
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const st = step ?? (integer ? 1 : 0.1);
              const nv = shown + (e.key === 'ArrowUp' ? st : -st);
              if (commit(String(nv))) setText(fmt(nv, digits));
            }
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
    </label>
  );
}

interface SelectProps<T extends string> {
  label: ReactNode;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}

export function SelectField<T extends string>({ label, value, options, onChange, disabled }: SelectProps<T>) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

export function CheckField({ label, checked, onChange }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function TextField({ label, value, onChange }: { label: ReactNode; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input id={id} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
    </label>
  );
}

/** Ligne "libellé : valeur" pour les résultats. */
export function Stat({ label, value, unit, tone }: { label: ReactNode; value: string; unit?: string; tone?: 'ok' | 'marginal' | 'danger' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value}
        {unit && <span className="unit"> {unit}</span>}
      </span>
    </div>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      <header>
        <h3>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}
