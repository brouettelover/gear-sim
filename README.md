# gear-sim

Simulation d'engrenages imprimés en 3D (FDM) entraînés par de petits moteurs DC (N20, 130, 370, 540).
Application web monopage (TypeScript + React + Vite), sans backend. Toute la logique de calcul
vit dans `src/core/`, en modules purs testés avec Vitest ; l'interface est dans `src/ui/`.

```bash
npm install
npm run dev     # application
npm test        # tests des modules de calcul
npm run build   # version statique dans dist/
```

Unités : SI en interne (m, rad, N·m, rad/s, kg, Pa) ; affichage en mm, N·mm et tr/min.

## Modules de calcul (`src/core`)

| Module | Rôle |
| --- | --- |
| `involute.ts` | Géométrie de la développante, entraxe de fonctionnement, rapport de conduite, avertissements |
| `profile.ts` | Contour 2D exact (développante + congé de pied trochoïdal), couronne, crémaillère, alésages |
| `motor.ts` | Identification du moteur DC depuis la fiche technique, préréglages |
| `simulation.ts` | Régime permanent et transitoire (RK4), profils de tension |
| `train.ts` | Trains simples, composés, planétaires : cinématique, phasage, rendement, inertie, efforts |
| `strength.ts` | Contrainte de Lewis et coefficient de sécurité |
| `materials.ts` | PLA, PETG, ABS, ASA, PA, PA-CF, POM |
| `export.ts` | STL (avec torsion hélicoïdale / chevron), SVG, DXF |
| `project.ts` | Modèle de projet (JSON), calcul complet |

## Formules utilisées

**Développante** (plan apparent, β angle d'hélice) : `mt = mn / cos β`, `tan αt = tan αn / cos β`,
`r = z·mt/2`, `rb = r·cos αt`, `ra = r + (1 + x)·mn`, `rf = r − (1 + c* − x)·mn`,
`inv α = tan α − α`, épaisseur au rayon R : `s_R = 2R·(s/2r + inv αt − inv αR)` avec `cos αR = rb/R`.
Le profil est obtenu en simulant le taillage par une crémaillère ISO 53 (arrondi de tête
`ρ = c*·m / (1 − sin α)`, soit 0,38·m) : la développante est analytique, le congé de pied et
l'éventuel dégagement sont la trace exacte de l'arrondi d'outil.

**Engrènement** : `inv αw = inv αt + 2·tan αn·(x1 + x2)/(z1 + z2)`, `a = (r1 + r2)·cos αt / cos αw`,
rapport de conduite `εα = [√(ra1² − rb1²) + √(ra2² − rb2²) − a·sin αw] / pb`, recouvrement
`εβ = b·sin β / (π·mn)`. Dégagement si `x < 1 − z·sin² αt / (2 cos β)`.

**Moteur DC** : `R = V/Is`, `Ke = (V − R·I0)/ω0`, `Kt = Ts/(Is − I0)`, `Tf = Kt·I0`.

**Simulation** : `L·di/dt = V − R·i − Ke·ω` et `J_eq·dω/dt = Kt·i − Tf − T_charge/(N·η)`,
avec `J_eq = J_rotor + Σ J_roue·(ωᵢ/ω)² + J_charge/N²`, intégrées par Runge-Kutta 4 à pas fixe.

**Lewis** : `σ = Kv·Ft / (b·m·Y)`, `Kv = (3,05 + V)/3,05`, Y tabulé (Shigley) au nombre de dents
virtuel `zv = z / cos³ β`. Coefficient de sécurité `n = σ_adm / σ` : vert ≥ 2, orange ≥ 1,25, rouge.

## Simplifications du modèle

- Rendement par engrènement constant (indépendant de la charge, de la vitesse et de la lubrification) ;
  planétaire : η² quel que soit le montage.
- Dents indéformables, pas de flexion des arbres ni de jeu de paliers ; le jeu au flanc n'est
  qu'un amincissement géométrique des dents.
- Lewis : effort appliqué en tête sur une seule dent, sans concentration de contrainte détaillée ni
  pression de contact (usure). Pièces imprimées supposées homogènes.
- Couronne et crémaillère : denture droite, sans déport ; couronne sans congé de pied.
- Planétaire : satellites équirépartis, partage de charge parfait, porte-satellites sans inertie.
- Moteur : paramètres constants (pas d'échauffement de R ni d'affaiblissement des aimants),
  frottement interne sec constant. PWM : bornes en court-circuit à l'état bas.
- Hélicoïdal : le congé de pied est calculé dans le plan apparent avec le rayon d'outil normal.
