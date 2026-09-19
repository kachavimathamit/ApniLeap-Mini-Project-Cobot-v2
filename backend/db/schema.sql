-- ApniLeap Mini-Project Portfolio Monitoring Portal
-- PostgreSQL schema (system of record). See requirements section 22.
-- Run with: psql -U postgres -d apnileap_portfolio -f schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Identity, roles, institute hierarchy
-- ============================================================

CREATE TABLE IF NOT EXISTS roles (
    id              SERIAL PRIMARY KEY,
    code            VARCHAR(40) UNIQUE NOT NULL,   -- e.g. PLATFORM_ADMIN
    name            VARCHAR(100) NOT NULL,
    description     TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(200) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_roles (
    id              SERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id         INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS institutes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code            VARCHAR(30) UNIQUE NOT NULL,    -- e.g. KLE, MMCOE
    name            VARCHAR(200) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Controls the order institutes are listed in (lower first, ties by name).
ALTER TABLE institutes ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 100;

-- Departments belong directly to an institute (Institute -> Department).
-- The id is an integer assigned by the database; the code (Dept-<id>) is also
-- generated automatically (trigger below) and never typed by a user.
CREATE TABLE IF NOT EXISTS departments (
    id              SERIAL PRIMARY KEY,
    institute_id    UUID NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
    code            VARCHAR(30) NOT NULL,
    name            VARCHAR(200) NOT NULL,
    head_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    coordinator_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (institute_id, code)
);

ALTER TABLE departments ADD COLUMN IF NOT EXISTS coordinator_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Fills in the code when none is supplied: Dept-<id>.
CREATE OR REPLACE FUNCTION set_department_code() RETURNS trigger AS $$
BEGIN
    IF NEW.code IS NULL OR btrim(NEW.code) = '' THEN
        NEW.code := 'Dept-' || NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_department_code ON departments;
CREATE TRIGGER trg_department_code BEFORE INSERT ON departments
    FOR EACH ROW EXECUTE FUNCTION set_department_code();

CREATE TABLE IF NOT EXISTS user_institute_access (
    id              SERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    institute_id    UUID NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, institute_id)
);

CREATE TABLE IF NOT EXISTS user_department_access (
    id              SERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department_id   INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, department_id)
);

-- ============================================================
-- Teams, projects
-- ============================================================

CREATE TABLE IF NOT EXISTS student_teams (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(200) NOT NULL,
    department_id   INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_code            VARCHAR(40) UNIQUE NOT NULL,
    title                   VARCHAR(300) NOT NULL,
    institute_id            UUID NOT NULL REFERENCES institutes(id) ON DELETE RESTRICT,
    department_id           INTEGER NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    student_team_id         UUID REFERENCES student_teams(id) ON DELETE SET NULL,
    mentor_user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
    academic_year           VARCHAR(20),
    semester                VARCHAR(20),
    start_date              DATE,
    expected_completion_date DATE,

    -- Project definition
    need_statement          TEXT,
    problem_statement       TEXT,
    objective                TEXT,
    learning_outcomes       TEXT,
    foundation_courses      TEXT,
    functional_blocks       TEXT,
    interfaces              TEXT,
    dependencies             TEXT,
    expected_deliverables   TEXT,

    -- Execution / status
    rag_status              VARCHAR(10) NOT NULL DEFAULT 'GREEN'
                              CHECK (rag_status IN ('GREEN','YELLOW','RED')),
    rag_since               TIMESTAMPTZ NOT NULL DEFAULT now(),
    completion_pct          SMALLINT NOT NULL DEFAULT 0 CHECK (completion_pct BETWEEN 0 AND 100),
    last_review_at          TIMESTAMPTZ,
    next_review_at          TIMESTAMPTZ,
    last_update_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    project_phase           VARCHAR(30) NOT NULL DEFAULT 'ACTIVE'
                              CHECK (project_phase IN ('PLANNED','ACTIVE','ON_HOLD','COMPLETED','ARCHIVED')),

    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_by              UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_institute ON projects(institute_id);
CREATE INDEX IF NOT EXISTS idx_projects_department ON projects(department_id);
CREATE INDEX IF NOT EXISTS idx_projects_mentor ON projects(mentor_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_rag ON projects(rag_status);

CREATE TABLE IF NOT EXISTS project_members (
    id              SERIAL PRIMARY KEY,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    student_name    VARCHAR(200),
    role_on_project VARCHAR(60) NOT NULL DEFAULT 'STUDENT',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every project has a fixed team of exactly four students. The slot number
-- (1-4) plus UNIQUE (project_id, slot) means a project can never hold more
-- than four; "exactly four" is enforced by the API, which only ever replaces
-- the whole team at once. The email is always SRN@kletech.ac.in, so it is
-- derived from the SRN instead of being stored separately.
CREATE TABLE IF NOT EXISTS project_students (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    slot            SMALLINT NOT NULL CHECK (slot BETWEEN 1 AND 5),
    name            VARCHAR(200) NOT NULL,
    srn             VARCHAR(20) NOT NULL CHECK (srn = upper(srn) AND srn ~ '^[A-Z0-9]{6,20}$'),
    semester        SMALLINT NOT NULL CHECK (semester BETWEEN 5 AND 8),
    division        VARCHAR(10) NOT NULL,
    email           VARCHAR(60) GENERATED ALWAYS AS (lower(srn) || '@kletech.ac.in') STORED,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, slot),
    UNIQUE (project_id, srn)
);

CREATE INDEX IF NOT EXISTS idx_project_students_project ON project_students(project_id);

-- ============================================================
-- Milestones, KPIs
-- ============================================================

CREATE TABLE IF NOT EXISTS milestones (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    due_date        DATE,
    status          VARCHAR(20) NOT NULL DEFAULT 'UPCOMING'
                      CHECK (status IN ('UPCOMING','IN_PROGRESS','COMPLETED','MISSED')),
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_milestones_project ON milestones(project_id);

CREATE TABLE IF NOT EXISTS kpis (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            VARCHAR(200) NOT NULL,
    target_value    VARCHAR(100),
    unit            VARCHAR(40),
    owner_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kpi_measurements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kpi_id          UUID NOT NULL REFERENCES kpis(id) ON DELETE CASCADE,
    measured_value  VARCHAR(100),
    evidence        TEXT,
    measured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    recorded_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kpi_measurements_kpi ON kpi_measurements(kpi_id);

-- ============================================================
-- Issues, corrective actions, reviews
-- ============================================================

CREATE TABLE IF NOT EXISTS issues (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title               VARCHAR(300) NOT NULL,
    root_cause          TEXT,
    impact              TEXT,
    support_required    TEXT,
    escalation_level    VARCHAR(30) NOT NULL DEFAULT 'NONE'
                          CHECK (escalation_level IN ('NONE','DEPARTMENT','INSTITUTE','PROGRAMME')),
    status              VARCHAR(20) NOT NULL DEFAULT 'OPEN'
                          CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED','CLOSED')),
    raised_by           UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id);

CREATE TABLE IF NOT EXISTS corrective_actions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    issue_id        UUID REFERENCES issues(id) ON DELETE SET NULL,
    description     TEXT NOT NULL,
    owner_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    due_date        DATE,
    evidence        TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'OPEN'
                      CHECK (status IN ('OPEN','IN_PROGRESS','COMPLETED','VERIFIED','OVERDUE')),
    completed_at    TIMESTAMPTZ,
    verified_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_actions_project ON corrective_actions(project_id);

CREATE TABLE IF NOT EXISTS reviews (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    reviewer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    review_date     TIMESTAMPTZ NOT NULL DEFAULT now(),
    comments        TEXT,
    decision        VARCHAR(30),
    recommended_status VARCHAR(10) CHECK (recommended_status IN ('GREEN','YELLOW','RED')),
    next_review_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_project ON reviews(project_id);

-- ============================================================
-- Status history, support requests, notifications, audit
-- ============================================================

CREATE TABLE IF NOT EXISTS status_history (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    previous_status VARCHAR(10) CHECK (previous_status IN ('GREEN','YELLOW','RED')),
    new_status      VARCHAR(10) NOT NULL CHECK (new_status IN ('GREEN','YELLOW','RED')),
    reason          TEXT,
    evidence        TEXT,
    changed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    approved_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_history_project ON status_history(project_id);

CREATE TABLE IF NOT EXISTS support_requests (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    requested_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    support_type    VARCHAR(40) NOT NULL DEFAULT 'GENERAL'
                      CHECK (support_type IN ('TECHNICAL','INSTITUTIONAL','INDUSTRY','GENERAL')),
    description     TEXT NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'OPEN'
                      CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_links (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    link_type       VARCHAR(20) NOT NULL DEFAULT 'OTHER'
                      CHECK (link_type IN ('GITHUB','CONFLUENCE','JIRA','REPORT','DEMO','OTHER')),
    label           VARCHAR(200) NOT NULL,
    url             TEXT NOT NULL,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_links_project ON project_links(project_id);

CREATE TABLE IF NOT EXISTS jira_links (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    jira_issue_key  VARCHAR(40) NOT NULL,
    jira_issue_id   VARCHAR(40),
    link_type       VARCHAR(30) NOT NULL DEFAULT 'PROJECT',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS confluence_links (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    confluence_page_id VARCHAR(60) NOT NULL,
    page_url        TEXT,
    link_type       VARCHAR(30) NOT NULL DEFAULT 'PROJECT_DOCS',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id      UUID REFERENCES projects(id) ON DELETE CASCADE,
    type            VARCHAR(50) NOT NULL,
    message         TEXT NOT NULL,
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    action          VARCHAR(80) NOT NULL,       -- e.g. LOGIN, LOGIN_FAILED, PROJECT_STATUS_CHANGE
    entity_type     VARCHAR(50),
    entity_id       VARCHAR(300),
    institute_id    UUID REFERENCES institutes(id) ON DELETE SET NULL,
    details         JSONB,
    ip_address      VARCHAR(64),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE audit_logs ALTER COLUMN entity_id TYPE VARCHAR(300);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

-- ============================================================
-- Names for leaders and project roles; fixed year/semester lists
-- ============================================================

-- A Dean, Department Head, Faculty Mentor, Project Coordinator or Reviewer
-- can be recorded by name. The *_user_id columns stay as an optional link to
-- a login account; the display name is used when there is no linked account.
ALTER TABLE departments ADD COLUMN IF NOT EXISTS head_display_name VARCHAR(200);
ALTER TABLE projects    ADD COLUMN IF NOT EXISTS faculty_mentor_name VARCHAR(200);
ALTER TABLE projects    ADD COLUMN IF NOT EXISTS coordinator_name    VARCHAR(200);
ALTER TABLE projects    ADD COLUMN IF NOT EXISTS reviewer_name       VARCHAR(200);

UPDATE projects p SET faculty_mentor_name = u.full_name
FROM users u WHERE u.id = p.mentor_user_id AND p.faculty_mentor_name IS NULL;

-- Academic year starts at 2026-27; semester is one of Sem-5 .. Sem-8.
-- Older free-text values are moved onto the allowed values first.
UPDATE projects SET academic_year = '2026-27'
WHERE academic_year IS NOT NULL AND academic_year !~ '^20(2[6-9]|[3-9][0-9])-[0-9]{2}$';
UPDATE projects SET semester = 'Sem-5'
WHERE semester IS NOT NULL AND semester NOT IN ('Sem-5','Sem-6','Sem-7','Sem-8');

ALTER TABLE projects DROP CONSTRAINT IF EXISTS chk_projects_academic_year;
ALTER TABLE projects ADD CONSTRAINT chk_projects_academic_year
    CHECK (academic_year IS NULL OR academic_year ~ '^20(2[6-9]|[3-9][0-9])-[0-9]{2}$');
ALTER TABLE projects DROP CONSTRAINT IF EXISTS chk_projects_semester;
ALTER TABLE projects ADD CONSTRAINT chk_projects_semester
    CHECK (semester IS NULL OR semester IN ('Sem-5','Sem-6','Sem-7','Sem-8'));

-- Students on a team are in semester 5-8 (older databases allowed 1-8).
UPDATE project_students SET semester = 5 WHERE semester < 5;
ALTER TABLE project_students DROP CONSTRAINT IF EXISTS project_students_semester_check;
ALTER TABLE project_students ADD CONSTRAINT project_students_semester_check CHECK (semester BETWEEN 5 AND 8);

-- ============================================================
-- Team ID, Artefact ID, Theme Name, Artefact Title
-- ============================================================

-- Team ID (Team-1, Team-2, ...) and Artefact ID (Art-1, Art-2, ...) come from
-- database sequences, so they are unique, increase by one for every project
-- that is added, and cannot collide when two people save at the same time.
CREATE SEQUENCE IF NOT EXISTS team_id_seq START 1;
CREATE SEQUENCE IF NOT EXISTS artefact_id_seq START 1;

-- The number follows the prefix directly, with no leading zeros (Team-1).
CREATE OR REPLACE FUNCTION format_seq_id(prefix TEXT, n BIGINT) RETURNS TEXT AS $$
    SELECT prefix || '-' || n::text
$$ LANGUAGE sql IMMUTABLE;

ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_id        VARCHAR(20);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS artefact_id    VARCHAR(20);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS theme_name     VARCHAR(200);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS artefact_title VARCHAR(300);

-- Existing projects get their numbers in the order they were created.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT id FROM projects WHERE team_id IS NULL OR artefact_id IS NULL ORDER BY created_at, project_code LOOP
        UPDATE projects
        SET team_id     = COALESCE(team_id,     format_seq_id('Team', nextval('team_id_seq'))),
            artefact_id = COALESCE(artefact_id, format_seq_id('Art',  nextval('artefact_id_seq')))
        WHERE id = r.id;
    END LOOP;
END $$;

ALTER TABLE projects ALTER COLUMN team_id     SET DEFAULT format_seq_id('Team', nextval('team_id_seq'));
ALTER TABLE projects ALTER COLUMN artefact_id SET DEFAULT format_seq_id('Art',  nextval('artefact_id_seq'));
ALTER TABLE projects ALTER COLUMN team_id     SET NOT NULL;
ALTER TABLE projects ALTER COLUMN artefact_id SET NOT NULL;
-- Older databases used TEAM-001 / ART-001; convert them to Team-1 / Art-1.
UPDATE projects SET team_id = 'Team-' || regexp_replace(team_id, '^TEAM-0*', '') WHERE team_id ~ '^TEAM-0*[0-9]+$';
UPDATE projects SET artefact_id = 'Art-' || regexp_replace(artefact_id, '^ART-0*', '') WHERE artefact_id ~ '^ART-0*[0-9]+$';
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_team_id     ON projects(team_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_artefact_id ON projects(artefact_id);

-- Projects that pre-date the field use their own title as the artefact title.
UPDATE projects SET artefact_title = title WHERE artefact_title IS NULL;

-- ============================================================
-- Owner names, unique SRN, exactly-10-digit contact numbers
-- ============================================================

-- Owners of corrective actions / escalations are typed names. The user-id
-- column stays as an optional link to an account.
ALTER TABLE corrective_actions ADD COLUMN IF NOT EXISTS owner_name VARCHAR(200);
UPDATE corrective_actions a SET owner_name = u.full_name
FROM users u WHERE u.id = a.owner_user_id AND a.owner_name IS NULL;
ALTER TABLE issues ADD COLUMN IF NOT EXISTS escalation_owner_name VARCHAR(200);

-- Contact number: exactly 10 digits (no more, no fewer).

-- An SRN identifies one student, so it may appear only once in the whole
-- system. If old data already repeats an SRN, the rule cannot be added yet:
-- remove the duplicate rows and run this script again.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_project_students_srn') THEN
        RETURN;
    END IF;
    IF EXISTS (SELECT 1 FROM project_students GROUP BY srn HAVING COUNT(*) > 1) THEN
        RAISE WARNING 'uq_project_students_srn NOT added: some SRNs appear more than once in project_students.';
    ELSE
        ALTER TABLE project_students ADD CONSTRAINT uq_project_students_srn UNIQUE (srn);
    END IF;
END $$;

-- ============================================================
-- Student login by SRN
-- ============================================================

-- A student's account is created automatically from the SRN on a project
-- team. The SRN is the login name (the account email is srn@kletech.ac.in).
ALTER TABLE users ADD COLUMN IF NOT EXISTS srn VARCHAR(20);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_srn ON users(srn) WHERE srn IS NOT NULL;

-- ============================================================
-- Requirements 1-6: no schools, integer department id, Dean/Head access by
-- department, teams of 4-5 students without a mobile number
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
    name        VARCHAR(80) PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Requirement 1: schools are gone; departments sit directly under an institute.
ALTER TABLE departments DROP CONSTRAINT IF EXISTS fk_departments_school_same_institute;
DROP INDEX IF EXISTS idx_departments_school;
ALTER TABLE departments DROP COLUMN IF EXISTS school_id;
DROP TABLE IF EXISTS schools;

-- Requirement 4: departments.id becomes an integer. Older databases used a UUID,
-- so the tables that point at a department are converted with it (once).
DO $$
BEGIN
    IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'departments' AND column_name = 'id') <> 'uuid' THEN
        RETURN;
    END IF;

    ALTER TABLE departments ADD COLUMN new_id INTEGER;
    UPDATE departments d SET new_id = r.rn
    FROM (SELECT id, row_number() OVER (ORDER BY created_at, code) AS rn FROM departments) r
    WHERE r.id = d.id;

    -- projects
    ALTER TABLE projects ADD COLUMN department_id_new INTEGER;
    UPDATE projects p SET department_id_new = d.new_id FROM departments d WHERE d.id = p.department_id;
    ALTER TABLE projects DROP COLUMN department_id;

    -- user_department_access
    ALTER TABLE user_department_access ADD COLUMN department_id_new INTEGER;
    UPDATE user_department_access a SET department_id_new = d.new_id FROM departments d WHERE d.id = a.department_id;
    ALTER TABLE user_department_access DROP COLUMN department_id;

    -- student_teams
    ALTER TABLE student_teams ADD COLUMN department_id_new INTEGER;
    UPDATE student_teams t SET department_id_new = d.new_id FROM departments d WHERE d.id = t.department_id;
    ALTER TABLE student_teams DROP COLUMN department_id;

    -- departments: integer primary key
    ALTER TABLE departments DROP CONSTRAINT departments_pkey;
    ALTER TABLE departments DROP COLUMN id;
    ALTER TABLE departments RENAME COLUMN new_id TO id;
    ALTER TABLE departments ALTER COLUMN id SET NOT NULL;
    ALTER TABLE departments ADD PRIMARY KEY (id);
    CREATE SEQUENCE IF NOT EXISTS departments_id_seq OWNED BY departments.id;
    PERFORM setval('departments_id_seq', COALESCE((SELECT MAX(id) FROM departments), 0) + 1, false);
    ALTER TABLE departments ALTER COLUMN id SET DEFAULT nextval('departments_id_seq');

    -- point the other tables at it again
    ALTER TABLE projects RENAME COLUMN department_id_new TO department_id;
    ALTER TABLE projects ALTER COLUMN department_id SET NOT NULL;
    ALTER TABLE projects ADD CONSTRAINT projects_department_id_fkey
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE RESTRICT;
    CREATE INDEX IF NOT EXISTS idx_projects_department ON projects(department_id);

    ALTER TABLE user_department_access RENAME COLUMN department_id_new TO department_id;
    ALTER TABLE user_department_access ALTER COLUMN department_id SET NOT NULL;
    ALTER TABLE user_department_access ADD CONSTRAINT user_department_access_department_id_fkey
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;
    ALTER TABLE user_department_access ADD CONSTRAINT user_department_access_user_id_department_id_key
        UNIQUE (user_id, department_id);

    ALTER TABLE student_teams RENAME COLUMN department_id_new TO department_id;
    ALTER TABLE student_teams ALTER COLUMN department_id SET NOT NULL;
    ALTER TABLE student_teams ADD CONSTRAINT student_teams_department_id_fkey
        FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE;
END $$;

-- A college cannot have two departments with the same name.
CREATE UNIQUE INDEX IF NOT EXISTS uq_departments_institute_name ON departments (institute_id, lower(name));

-- Requirement 2: a Dean or Department Head sees only the departments they are
-- given (user_department_access). The first time this runs, existing Heads get
-- their own department and existing Deans get all departments of their college.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM schema_migrations WHERE name = 'dean_head_department_access_v1') THEN
        RETURN;
    END IF;
    INSERT INTO user_department_access (user_id, department_id)
    SELECT head_user_id, id FROM departments WHERE head_user_id IS NOT NULL
    ON CONFLICT DO NOTHING;
    INSERT INTO user_department_access (user_id, department_id)
    SELECT DISTINCT u.id, d.id
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id AND r.code = 'DEAN_PRINCIPAL'
    JOIN user_institute_access uia ON uia.user_id = u.id
    JOIN departments d ON d.institute_id = uia.institute_id
    ON CONFLICT DO NOTHING;
    INSERT INTO schema_migrations (name) VALUES ('dean_head_department_access_v1');
END $$;

-- Requirement 6: teams of 4 or 5 students, and no mobile number.
ALTER TABLE project_students DROP COLUMN IF EXISTS contact_no;
ALTER TABLE project_students DROP CONSTRAINT IF EXISTS project_students_slot_check;
ALTER TABLE project_students ADD CONSTRAINT project_students_slot_check CHECK (slot BETWEEN 1 AND 5);

-- ============================================================
-- updated_at auto-touch trigger
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT unnest(ARRAY['users','institutes','departments','student_teams','projects','project_students',
                             'milestones','kpis','issues','corrective_actions','support_requests'])
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_set_updated_at ON %I; CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
            t, t
        );
    END LOOP;
END $$;
