# Backend Roadmap

## Objectif

Construire un backend volontairement simple a brancher derriere l'UI actuelle,
avant d'attaquer la vectorisation et les appels LLM.

## Etape 1 - Base de donnees

Artefacts disponibles :

- `database/schema.sql`
- `database/seed.sql`

Contenu :

- schema PostgreSQL,
- extension `pgvector`,
- entites metier principales,
- vues de calcul de validite,
- donnees de demo coherentes.

## Etape 2 - API fonctionnelle minimale

Ressources API a exposer en priorite :

- `POST /auth/login`
- `GET /me`
- `GET /ships`
- `PATCH /ships/:id`
- `GET /ships/:id/timeline`
- `POST /ships/:id/audits`
- `GET /controllers`
- `GET /controllers/:id/timeline`
- `POST /controller-activities`
- `GET /documents`
- `POST /documents`
- `GET /retention-settings`
- `PATCH /retention-settings`

## Etape 3 - Mode planification d'audit

Le backend doit fournir un payload compose :

- frise navire,
- frises controleurs,
- audits deja programmes,
- activites navires,
- activites controleurs,
- contraintes temporelles utiles a la decision.

## Etape 4 - Vectorisation

Une fois l'etape 2 stable :

- ingestion documentaire,
- projection SQL en documents metier,
- indexation `pgvector`,
- recherche hybride filtree par droits.
