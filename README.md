# ApniLeap Mini-Project Portfolio Monitoring Portal (Cobot v2)

A web portal for tracking mini-projects across colleges (institutes), their departments
and student project teams. It shows every project's RAG status (Green / Yellow / Red),
progress, issues, corrective actions and reviews, and keeps Jira and Confluence in step.

- **Frontend:** HTML5, CSS3, Bootstrap 5, vanilla JavaScript (served by the backend)
- **Backend:** Node.js + Express 4
- **Database:** PostgreSQL 14+ (system of record)
- **Integrations:** Jira Cloud and Confluence Cloud, called only from the backend

---

## Contents

1. [Quick start](#1-quick-start)
2. [Configuration (`.env`)](#2-configuration-env)
3. [Database](#3-database)
4. [Demo accounts](#4-demo-accounts)
5. [Roles and what they can do](#5-roles-and-what-they-can-do)
6. [Feature guide](#6-feature-guide)
7. [Bulk upload by CSV](#7-bulk-upload-by-csv)
8. [Jira and Confluence](#8-jira-and-confluence)
9. [Project layout](#9-project-layout)
10. [Security notes](#10-security-notes)
11. [Testing notes](#11-testing-notes)
12. [Troubleshooting](#12-troubleshooting)
13. [Known limitations](#13-known-limitations)

Other documents: `DATABASE_SCHEMA.txt` (full schema, 25 tables), `SAMPLE_WALKTHROUGH.txt`
(step-by-step run-through with sample data for all roles).

---

## 1. Quick start

Prerequisites: **Node.js 18+**, **PostgreSQL 14+** running locally, and (optional) an
Atlassian Cloud site for the Jira/Confluence sync. The app runs without Atlassian; it just
skips the sync.

```bash
git clone https://github.com/kachavimathamit/ApniLeap-Mini-Project-Cobot-v2.git
cd ApniLeap-Mini-Project-Cobot-v2/backend
npm install
copy .env.example .env        # Windows   (Linux/macOS: cp .env.example .env)
```

Edit `.env` (next section), create the database once, then load the schema and demo data:

```bash
# create the empty database once (psql or pgAdmin)
#   CREATE DATABASE apnileap_portfolio;

npm run db:init       # applies backend/db/schema.sql (safe to run again; it migrates older databases)
npm run db:seed       # roles, institutes, KLE departments, demo users, demo projects and teams
npm start             # API + website on http://localhost:4000
```

Open http://localhost:4000 and sign in with a demo account (section 4).

Scripts (`backend/package.json`): `npm start`, `npm run db:init`, `npm run db:seed`,
`npm run db:students` (creates a login for every student already on a team).

---

## 2. Configuration (`.env`)

Copy `backend/.env.example` to `backend/.env`. **Never commit `.env`** (it is git-ignored).

| Variable | Meaning |
|---|---|
| `PORT` | Web port (default 4000) |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` | PostgreSQL connection |
| `JWT_SECRET` | Long random string that signs login tokens. **Change it.** |
| `JWT_EXPIRES_IN` | Login lifetime (default `8h`) |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY` | Jira Cloud (all four needed) |
| `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN`, `CONFLUENCE_SPACE_KEY` | Confluence Cloud |

Atlassian API tokens: https://id.atlassian.com/manage-profile/security/api-tokens

---

## 3. Database

Schema: `backend/db/schema.sql` (idempotent: `CREATE ... IF NOT EXISTS` plus guarded
migrations). Seed data: `backend/db/seed.js`. Full description: `DATABASE_SCHEMA.txt`.

Hierarchy: **institute -> department -> project**. Departments have an integer id and an
automatic code (`Dept-<id>`). Projects get automatic `Team-n` and `Art-n` ids from sequences.

Back up and restore (PostgreSQL command line tools):

```bash
pg_dump -U postgres -h localhost -d apnileap_portfolio -f apnileap_backup.sql
psql -U postgres -h localhost -d postgres -c "CREATE DATABASE apnileap_restore"
psql -U postgres -h localhost -d apnileap_restore -f apnileap_backup.sql
```

Dumps contain real people's data and password hashes, so keep them private.

---

## 4. Demo accounts

Created by `npm run db:seed`. Password for all: **`Demo@12345`** (demo only; change for real use).

| Email | Role | Scope |
|---|---|---|
| `platform.admin@apnileap.org` | Platform Administrator | everything |
| `programme.leader@apnileap.org` | Global Programme Leader | all colleges |
| `kle.admin@apnileap.org` | Institute Administrator | KLE |
| `kle.dean@apnileap.org` | Dean/Principal | KLE departments CSE and CSEAI |
| `kle.hod.cse@apnileap.org` | Department Head | CSE |
| `kle.hod.cseai@apnileap.org` | Department Head | CSEAI |
| `kle.mentor@apnileap.org` | Faculty Mentor | KLE |
| `kle.reviewer@apnileap.org` | Reviewer/Success Coach | KLE |
| `kle.readonly@apnileap.org` | Read-only Stakeholder | KLE |

**Students** sign in with their **SRN** (any case) or `srn@kletech.ac.in` and the default
password `Demo@12345`. Their account is created automatically when a project team is saved.
A student sees only their own team's project, read-only.

---

## 5. Roles and what they can do

| Role | Highlights |
|---|---|
| Platform Administrator | Adds/edits/deletes institutes; manages all users, departments; everything else |
| Global Programme Leader | Views and works across all colleges |
| Institute Administrator | Users and departments of their own college; user search |
| Dean/Principal, Department Head | See and work in **only the departments they are given**; create projects, change status, approve Red -> Green |
| Faculty Mentor | Whole college: create projects, status, milestones, KPIs, actions, team, CSV upload |
| Reviewer/Success Coach | Adds reviews, verifies corrective actions (cannot change status) |
| Read-only Stakeholder | Views dashboards, projects, reports only |
| Student | Own team's project, read-only (no edits, no admin/institute pages) |

Every rule is enforced by the API on each request; hiding a button in the UI is only a
convenience. Tenant isolation: users never see another college's data.

---

## 6. Feature guide

**Navigation:** Dashboard, Institutes, Reports, Administration.

- **Institutes -> Department -> Project pages.** Departments are added by typing only a name
  (and a Head); id and code are automatic. Deleting a department or institute also deletes its
  projects (confirmation; the server refuses without `cascade=true`).
- **Project page.** Header: code, Team ID, Artefact ID, mentor, RAG and completion, with
  Update Status / Add Issue / Add Corrective Action / Add Review. Tabs: **Overview**
  (Execution details, Student Team with Edit Team, Jira & Confluence, Links), **Cobot**
  (placeholder), **Project Tracking** (Definition, Milestones, KPIs, Challenges, Actions,
  Reviews, Documentation).
- **RAG workflow.** Green <-> Yellow <-> Red. Moving to Red records a full intervention
  (blocker, root cause, impact, owner, due date...). Red -> Green needs a *verified*
  corrective action, evidence and approval by an authorized role. **Completion %** is set in
  Update Status (with a status change, or alone via "No status change").
- **Project team.** 4 students plus an optional 5th (Name, SRN, Semester, Division). Email is
  automatic (`srn@kletech.ac.in`). An SRN can belong to only one team.
- **Project details.** Theme Name, Artefact Title, Faculty Mentor / Coordinator / Reviewer
  names, Academic Year (drop-down, 2026-27 onward), Semester (Sem-5 to Sem-8).
- **Reports page tabs.** Weekly Report (Export CSV / Print), and the lists **Projects**,
  **Issues**, **Reviews**. The Projects list filters by Institute -> Department -> Faculty
  Mentor / Theme, RAG status and text search (title, code, Team/Artefact ID, theme, mentor).
- **Administration.** *Users:* search by Organization, Role and Details (results appear only
  after Search; students never listed; Dean/Head get a Department access editor).
  *Institutes* (Platform Admin) and *Departments*: Edit and Delete.
- **Security-minded UI.** All user text is HTML-escaped (`esc()` in `frontend/js/api.js`);
  status is never shown by colour alone (coloured circles with accessible labels).

---

## 7. Bulk upload by CSV

Department page -> **Upload CSV** (roles: Faculty Mentor and above).

1. Download the template. One row per project: Theme Name, Artefact Title, Project Title,
   Faculty Mentor Name, Project Coordinator Name, Reviewer Name, Academic Year, Semester, then
   Student 1-4 (Name, SRN, Semester, Division) and an optional Student 5.
2. Fill it in (Excel: format Academic Year / Semester as Text) and choose the file.
3. Every row is checked. If anything is wrong the **whole file is rejected** with row numbers
   and nothing is saved. Otherwise **Import** creates all projects, teams and student logins in
   one transaction (Team-n / Art-n in file order), max 200 projects per file. Jira issues and
   Confluence pages are then created in the background.

---

## 8. Jira and Confluence

With the Atlassian variables set, each new project creates a Jira issue and a Confluence page,
and status changes post Jira comments. The calls are best-effort: an Atlassian outage never
blocks the portal. A `/api/webhooks/jira` receiver is included (inert on localhost).

---

## 9. Project layout

```
backend/
  server.js            Express app, error handling, static hosting of frontend/
  config/db.js         PostgreSQL pool
  db/                  schema.sql, seed.js, init.js, sync-students.js
  controllers/ routes/ middleware/ services/ validators/
frontend/
  index.html           Sign-in
  pages/               Dashboard, Institutes, Department, Project, Reports, Administration
  js/ css/             Page scripts and styles
DATABASE_SCHEMA.txt    Generated schema description
SAMPLE_WALKTHROUGH.txt End-to-end sample data walkthrough
```

---

## 10. Security notes

- Passwords are hashed with bcrypt; sessions are JWTs (`JWT_SECRET` must be long and private).
- Role and tenant checks run server-side on every request; login attempts are rate-limited.
- `.env`, database dumps and `node_modules` are git-ignored. **Do not publish real
  credentials, API tokens or database dumps** (they contain student names, SRNs and hashes).
- The demo password `Demo@12345` and the default student password are for demos only. There is
  no change-password screen yet.
- If an API token was ever shared in chat or committed, revoke it and create a new one.

---

## 11. Testing notes

There is no automated test suite in the repository. Changes were verified with scripted API
checks against scratch databases (Jira/Confluence variables left blank so no real issues are
created) and with the running app in a browser: role permission matrix (9 roles), tenant
isolation, contrast (WCAG AA 4.5:1), layout from 375 px to 1366 px, CSV import rules.

---

## 12. Troubleshooting

| Problem | Fix |
|---|---|
| `EADDRINUSE` / port 4000 busy | Stop the other server or set `PORT` in `.env` |
| `password authentication failed` | Check `PGUSER` / `PGPASSWORD` in `.env` |
| Sign-in locked after failed tries | Wait, or restart the server (only failed attempts count) |
| `uq_project_students_srn NOT added` warning | Some SRN appears on two teams; remove the duplicate, run `npm run db:init` again |
| Jira/Confluence not syncing | All four variables per product must be set; check the server log |

---

## 13. Known limitations

- Faculty Mentors and Reviewers can read every project of their college.
- No change-password or forgot-password screen; students share one default password.
- `projects.start_date` / `expected_completion_date` columns remain in the database but are unused.
- The Cobot tab is a placeholder.
