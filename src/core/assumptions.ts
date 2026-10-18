/** Simplifications du modèle, affichées dans l'interface et dans la fiche récapitulative. */
export const SIMPLIFICATIONS: { title: string; items: string[] }[] = [
  {
    title: 'Géométrie',
    items: [
      'Profil en développante exact, taillé par une crémaillère ISO 53 (congé de pied ρ = c*·m/(1 − sin α)).',
      'Hélicoïdal : profil calculé dans le plan apparent ; le congé utilise le rayon d\'outil normal (approximation).',
      'Couronne intérieure et crémaillère : denture droite, sans déport ; couronne sans congé de pied, tête limitée au cercle de base.',
      'Jeu au flanc obtenu en amincissant chaque dent de la moitié du jeu ; l\'entraxe reste l\'entraxe théorique.',
      'Pas de raccourcissement de tête automatique en cas de déport (un avertissement signale un jeu en pied insuffisant).',
    ],
  },
  {
    title: 'Train et rendement',
    items: [
      'Rendement par engrènement constant, indépendant de la charge, de la vitesse et de la lubrification.',
      'Planétaire : rendement η² quel que soit le montage, satellites équirépartis, partage de charge parfait, porte-satellites sans inertie.',
      'Paliers et arbres sans frottement ni flexion ; pas de jeu de fonctionnement dans la cinématique.',
    ],
  },
  {
    title: 'Montage 3D',
    items: [
      'Collisions testées sur les encombrements (cercle de tête, jante de couronne, rectangle de crémaillère) au repos, pas sur le profil exact des dents.',
      'Tiges, flasques et arbre moteur rigides ; aucun jeu axial ni radial pris en compte dans l\'engrènement.',
      'Hélicoïdal : la phase des dents n\'est cohérente qu\'entre roues dont les faces inférieures sont au même niveau.',
      'Pièces fusionnées : roues et entretoise juxtaposées dans un même fichier (coques qui se touchent, sans union booléenne) ; les trancheurs les réunissent.',
      'Flasques rectangulaires sans fixation du moteur (vis) ni entretoises entre flasques : à ajouter selon votre moteur et votre châssis.',
    ],
  },
  {
    title: 'Moteur et simulation',
    items: [
      'Moteur DC à paramètres constants : R ne varie pas avec la température, aimants stables.',
      'Frottement interne sec constant (Tf = Kt·I0), lissé autour de la vitesse nulle.',
      'Motoréducteurs (N20) : la fiche technique est celle de la sortie du réducteur intégré ("moteur équivalent").',
      'PWM : bornes court-circuitées à l\'état bas (freinage), alimentation idéale sans chute de tension.',
      'Couple constant et poids de sens fixe : ils peuvent entraîner le moteur à l\'envers.',
    ],
  },
  {
    title: 'Résistance',
    items: [
      'Formule de Lewis : effort en tête sur une seule dent, facteur de forme tabulé, facteur dynamique de Barth.',
      'Pas de calcul de pression de contact (usure, piqûres) ni d\'échauffement des dents.',
      'Dents indéformables pour la cinématique ; matériau imprimé supposé homogène et isotrope dans le plan des couches.',
      'Contraintes admissibles prudentes et indicatives : à valider par un essai avec vos réglages d\'impression.',
    ],
  },
];
