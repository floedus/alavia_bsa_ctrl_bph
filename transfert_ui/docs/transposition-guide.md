# Guide de transposition

## Objectif

Reprendre la continuité visuelle et ergonomique d'ICARE sans reutiliser son metier.

## Niveau de reutilisation conseille

### Reutilisation directe

- `icare-theme.css`
- `TopNav.tsx`
- `DateTimeStepper.tsx`
- `platformTime.ts`

### Reutilisation avec adaptation

- `PlanningTimeline.reference.tsx`

Ce composant contient deja :

- la logique de fenetre temporelle
- le zoom
- la selection d'activite
- le drag / resize
- la gestion des lanes
- l'affichage de blocs temporels
- les marqueurs jour / nuit

Mais il depend encore de concepts ICARE :

- `@icare/shared`
- `MissionCard`
- `AlertCard`
- `SimulatorSessionCard`
- `turnaroundMode`
- `constraintStatus`
- `constraintEvaluations`

## Adaptation conseillee de la frise

Le plus propre est de creer dans le nouveau projet :

- `TimelineBlock`
- `TimelineResource`
- `TimelineConstraintState`
- `TimelineBoard`

en repartant de `PlanningTimeline.reference.tsx`.

### Mapping minimum a refaire

Dans le nouveau projet, remplacer les types ICARE par un bloc generique du style :

```ts
type TimelineBlock = {
  id: string;
  code: string;
  title: string;
  start: string;
  end: string;
  status: string;
  kind: string;
  resourceCode?: string;
  constraintStatus?: "compliant" | "warning" | "blocking";
};
```

Puis adapter les callbacks :

- `onSelectEntry(...)`
- `onScheduleChange(...)`
- `onDeleteEntry(...)`
- `onMarkPlanned(...)`

## Ce qu'il faut garder

- l'echelle temporelle
- les interactions de glisser / redimensionnement
- la densite visuelle
- les panneaux et badges de statut
- le style de navigation

## Ce qu'il faut enlever ou renommer

- les references aeronef / mission / simulateur
- les libelles ICARE
- les imports `@icare/shared`
- les notions de `turnaroundMode` si elles n'ont pas de sens dans le nouveau metier

## Ordre de travail recommande

1. integrer la feuille de style
2. afficher une page shell avec `TopNav`
3. brancher la nouvelle frise avec des donnees fictives
4. brancher la selection d'un bloc
5. brancher le drag / resize
6. seulement ensuite connecter le nouveau backend
