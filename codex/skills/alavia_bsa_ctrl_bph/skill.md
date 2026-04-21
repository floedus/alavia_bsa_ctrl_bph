# skill.md - Reference unique du projet alavia_bsa_ctrl_bph

## 1. Objet

L'application couvre la planification, l'execution, le suivi documentaire et
l'administration fonctionnelle des controles aeronautiques BPH.

Ce `skill.md` est la reference unique du projet. Tout ancien `agent.md` est
absorbe ici et ne doit plus etre maintenu.

## 2. Metier

### 2.1 Audit

Un audit est defini par :

- un navire,
- une date de mise en route des controleurs,
- une date de debut d'audit,
- une date de fin d'audit,
- une date de retour metropole,
- un statut `programme` ou `valide`,
- un ou plusieurs controleurs affectes,
- des notes libres.

Un audit n'est jamais purge automatiquement.

Lorsqu'un audit est `valide`, il devient la reference du dernier audit valide
du navire pour le calcul de validite.

### 2.2 Validite

La fin de validite d'un navire est calculee en prenant :

1. la date de fin du dernier audit `valide`,
2. la periodicite du navire en mois,
3. le dernier jour du mois obtenu.

Dans l'UI, toute zone au-dela de cette date doit etre teintee en rouge de
maniere visible.

### 2.3 Activites navires

La frise navire affiche :

- les audits,
- la fin de validite,
- les activites personnalisees navire.

Categories minimales :

- maintenance,
- exercice,
- mission,
- indisponibilite navire,
- autre.

### 2.4 Activites controleurs

La frise controleur affiche :

- les audits sur lesquels le controleur est affecte,
- les activites personnelles declarees par le controleur,
- les indisponibilites visibles par le planificateur.

Categories minimales :

- permission,
- stage,
- mission,
- formation,
- indisponibilite,
- autre.

Les audits visibles dans la frise controleur sont en lecture seule depuis cette
frise : ni modification, ni suppression, ni drag/resize depuis cette vue.

## 3. Frises et ergonomie

### 3.1 Echelle

- fenetre glissante sur 12 mois,
- debut de fenetre au premier jour du mois precedent le mois courant,
- precision au jour,
- visualisation jours, semaines et week-ends,
- zoom jusqu'a `1000%`,
- en dessous de `400%`, les numeros de jours sont masques,
- le zoom doit garder le bloc selectionne comme point focal.

### 3.2 Mode planification d'audit

Le bouton `Planifier un audit` d'un navire ouvre une vue dediee avec :

- une frise navire,
- les frises de tous les controleurs,
- un en-tete temporel mutualise,
- un zoom et un scroll horizontal integralement synchronises.

En creation ou edition d'audit, il faut pouvoir affecter un ou plusieurs
controleurs. Les affectations doivent faire apparaitre l'audit sur les frises
des controleurs concernes.

### 3.3 Representation visuelle des audits

Le bloc audit doit distinguer visuellement :

- la phase de ralliement aller,
- la phase d'audit,
- la phase de ralliement retour.

Le detail d'un audit s'edite sous la frise avec des dates au format
`dd/mm/yyyy` sans heure.

## 4. Documents

Les documents sont stockes en local, pas en binaire dans la base.

Modele retenu :

- fichier dans le systeme de fichiers,
- metadonnees en base SQL,
- chemin local en base via `storage_path`.

Arborescence cible :

- `storage/documents/<code_navire_normalise>/`
- `storage/documents/<code_navire_normalise>/archives/`

Lors de la creation d'un navire, il faut pouvoir saisir :

- la date du dernier audit, nullable,
- des documents d'archive multiples.

La vue `Documents` est classee par navire, repliee par defaut, avec acces rapide
au dernier CR et au dernier CR a chaud.

## 5. Purge

Le delai avant purge automatique est parametrable, `180 jours` par defaut.

La purge ne concerne que :

- les activites navires hors audits,
- les activites controleurs.

La purge ne doit jamais concerner :

- les audits,
- les documents.

## 6. Comptes et droits

Profils :

- `administrateur`
- `controleur`
- `controleur_planificateur`
- `officier_avia_bph`

Regles :

- `administrateur` : acces total.
- `controleur` : lecture/ecriture sur sa frise personnelle, lecture sur les
  frises navires, acces documentaire selon la politique retenue.
- `controleur_planificateur` : tous les menus sauf gestion utilisateurs.
- `officier_avia_bph` : lecture seule sur la frise de son navire et son
  historique documentaire.

Chaque utilisateur peut etre :

- fusionne avec un controleur pour les profils `controleur` et
  `controleur_planificateur`,
- fusionne avec un navire pour le profil `officier_avia_bph`,
- non fusionne pour un `administrateur`.

L'application doit exposer :

- une page de connexion par identifiant et mot de passe,
- un menu `Utilisateurs` avec ajout, modification, suppression,
- attribution du profil,
- fusion controleur ou navire,
- initialisation ou modification du mot de passe.

## 7. Regles de suppression controleur

Si un controleur est supprime :

- il doit etre retire de toutes les affectations d'audit,
- son compte doit etre desactive plutot que detruit,
- les audits restent conserves.

Processus recommande :

1. supprimer les lignes `audit_controllers` liees,
2. desactiver le compte utilisateur,
3. conserver une trace dans le journal d'audit.

## 8. Hors perimetre premier deploiement

Le menu LLM et tout le volet vectorisation / RAG / appel LLM sont retires du
premier deploiement operationnel.

Les tables techniques peuvent rester en base si elles n'interferent pas avec le
fonctionnel, mais elles ne doivent plus apparaitre dans l'UI ni orienter les
choix produit de cette premiere version.
