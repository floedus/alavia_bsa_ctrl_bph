# ALAVIA BSA CTRL BPH

Application de planification des audits BPH avec :
- un frontend React/Vite,
- un backend Node/Express,
- une base PostgreSQL.

## Prerequis

- Node.js 18+ avec `npm`
- PostgreSQL avec `psql`

## Structure

- `frontend/` : interface utilisateur
- `backend/` : API
- `database/schema.sql` : schema PostgreSQL
- `database/seed.sql` : donnees de demonstration
- `storage/documents/` : stockage local des documents

## 1. Creer la base

Depuis la racine du projet :

```powershell
createdb alavia_bsa_ctrl_bph
psql -d alavia_bsa_ctrl_bph -f .\database\schema.sql
psql -d alavia_bsa_ctrl_bph -f .\database\seed.sql
```

Si vous devez preciser l'utilisateur PostgreSQL :

```powershell
createdb -U postgres alavia_bsa_ctrl_bph
psql -U postgres -d alavia_bsa_ctrl_bph -f .\database\schema.sql
psql -U postgres -d alavia_bsa_ctrl_bph -f .\database\seed.sql
```

## 2. Configurer le backend

Copier le fichier d'exemple :

```powershell
cd .\backend
Copy-Item .env.example .env
```

Renseigner ensuite `backend/.env` :

```env
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres
PGPASSWORD=VOTRE_MOT_DE_PASSE
PGDATABASE=alavia_bsa_ctrl_bph
PORT=8081
```

## 3. Installer les dependances

Backend :

```powershell
cd .\backend
npm.cmd install
```

Frontend :

```powershell
cd .\frontend
npm.cmd install
```

## 4. Lancer l'application

Backend :

```powershell
cd .\backend
npm.cmd run dev
```

Frontend :

```powershell
cd .\frontend
npm.cmd run dev -- --host 127.0.0.1 --port 4173
```

## 5. Acces

- Frontend : `http://127.0.0.1:4173/`
- Backend : `http://127.0.0.1:8081/api/health`

## 6. Comptes de demonstration

- `admin / admin`
- `martin / martin`
- `planif / planif`
- `colin / colin`
- `avia-ton / avia-ton`

## 7. Documents

Les documents televerses sont stockes localement dans :

```text
storage/documents/
```

Organisation :

- `storage/documents/<navire>/archives/`
- `storage/documents/<navire>/audits/<audit>/`

## 8. Verifications utiles

Verifier que la base repond :

```powershell
psql -d alavia_bsa_ctrl_bph -c "select now();"
```

Verifier que l'API repond :

```powershell
Invoke-RestMethod -Method Get -Uri http://127.0.0.1:8081/api/health
```

Verifier le typage frontend :

```powershell
cd .\frontend
node_modules\.bin\tsc.cmd -b
```

Verifier la syntaxe backend :

```powershell
cd .\backend
node --check .\src\server.js
```
