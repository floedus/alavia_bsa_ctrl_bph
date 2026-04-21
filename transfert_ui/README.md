# Dossier de transfert UI

Ce dossier sert a transferer dans un autre projet :

- la charte graphique ICARE
- les principaux patterns d'interface
- la base technique de la frise temporelle

Il ne contient volontairement pas :

- la logique metier ICARE
- la base de donnees
- les APIs
- les types partages `@icare/shared`

L'idee est de copier ce dossier dans le nouveau projet, puis de l'adapter sur place.

## Contenu

- `styles/icare-theme.css`
  - charte graphique complete actuelle
  - couleurs, panels, navigation, formulaires, frises, badges

- `components/TopNav.tsx`
  - pattern de navigation horizontale
  - simple a rebrancher sur d'autres onglets metier

- `components/DateTimeStepper.tsx`
  - composant de saisie temporelle a pas fixes

- `components/platformTime.ts`
  - helpers de conversion et de manipulation horaire

- `components/PlanningTimeline.reference.tsx`
  - frise ICARE d'origine, conservee comme reference fonctionnelle
  - a adapter au nouveau metier

- `components/turnaroundMode.reference.ts`
  - dependance specifique ICARE de la frise de reference
  - utile seulement si tu repars du composant brut

- `docs/transposition-guide.md`
  - mode d'emploi pour adapter ce socle dans le nouveau projet

## Strategie recommandee

1. Copier d'abord `styles/icare-theme.css`
2. Rebrancher `TopNav.tsx`
3. Reprendre `DateTimeStepper.tsx` et `platformTime.ts`
4. Adapter la frise a partir de `PlanningTimeline.reference.tsx`
5. Remplacer les types ICARE par les types du nouveau metier

## Nettoyage ensuite

Une fois le transfert termine :

1. supprimer ce dossier du projet ICARE
2. garder uniquement les fichiers finalises dans le nouveau projet
