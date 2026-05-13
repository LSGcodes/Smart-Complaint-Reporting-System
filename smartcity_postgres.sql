-- ============================================================
--  SMART CITY COMPLAINT REPORTING SYSTEM
--  Converted to PostgreSQL
-- ============================================================

-- ============================================================
-- TABLE 1: USERS
-- ============================================================
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  id_number     VARCHAR(20)  UNIQUE NOT NULL,
  full_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'Citizen'
                  CHECK (role IN ('Citizen','Technician','Administrator','Councillor')),
  phone         VARCHAR(20),
  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- TABLE 2: COMPLAINTS
-- ============================================================
CREATE TABLE complaints (
  id                       SERIAL PRIMARY KEY,
  ref_id                   VARCHAR(20) UNIQUE NOT NULL,
  citizen_id               INT NOT NULL,
  category                 VARCHAR(20) NOT NULL
                             CHECK (category IN ('water','electricity','pothole','sewage','facility')),
  description              TEXT NOT NULL,
  address                  VARCHAR(255),
  latitude                 DECIMAL(10,7),
  longitude                DECIMAL(10,7),
  photo_url                VARCHAR(500),
  status                   VARCHAR(20) DEFAULT 'Submitted'
                             CHECK (status IN ('Submitted','Classified','Assigned','In Progress','Resolved')),
  priority                 VARCHAR(20) DEFAULT 'Medium'
                             CHECK (priority IN ('Low','Medium','High','Critical')),
  ai_category              VARCHAR(50),
  ai_priority              VARCHAR(20),
  admin_overridden         BOOLEAN DEFAULT FALSE,
  council_review_requested BOOLEAN DEFAULT FALSE,
  rating                   SMALLINT,
  rating_comment           TEXT,
  created_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (citizen_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- TABLE 3: ASSIGNMENTS
-- ============================================================
CREATE TABLE assignments (
  id              SERIAL PRIMARY KEY,
  complaint_id    INT NOT NULL,
  technician_id   INT NOT NULL,
  assigned_by     INT NOT NULL,
  assigned_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  task_start_date DATE,
  task_end_date   DATE,
  notes           TEXT,
  FOREIGN KEY (complaint_id)  REFERENCES complaints(id) ON DELETE CASCADE,
  FOREIGN KEY (technician_id) REFERENCES users(id),
  FOREIGN KEY (assigned_by)   REFERENCES users(id)
);

-- ============================================================
-- TABLE 4: STATUS HISTORY
-- ============================================================
CREATE TABLE status_history (
  id           SERIAL PRIMARY KEY,
  complaint_id INT NOT NULL,
  changed_by   INT NOT NULL,
  old_status   VARCHAR(50),
  new_status   VARCHAR(50) NOT NULL,
  notes        TEXT,
  photo_url    VARCHAR(500),
  changed_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by)   REFERENCES users(id)
);

-- ============================================================
-- TABLE 5: ESCALATIONS
-- ============================================================
CREATE TABLE escalations (
  id              SERIAL PRIMARY KEY,
  complaint_id    INT NOT NULL,
  councillor_id   INT NOT NULL,
  escalated_by    INT NOT NULL,
  escalation_type VARCHAR(20) DEFAULT 'auto'
                    CHECK (escalation_type IN ('auto','citizen_request')),
  decision        VARCHAR(50) DEFAULT 'Pending'
                    CHECK (decision IN ('Pending','Approved Emergency Budget','Direct Resources','Escalate to Management','Schedule Site Visit')),
  decision_notes  TEXT,
  escalated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  decided_at      TIMESTAMP NULL,
  FOREIGN KEY (complaint_id)  REFERENCES complaints(id) ON DELETE CASCADE,
  FOREIGN KEY (councillor_id) REFERENCES users(id),
  FOREIGN KEY (escalated_by)  REFERENCES users(id)
);

-- ============================================================
-- TABLE 6: NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL,
  complaint_id INT,
  type         VARCHAR(10) DEFAULT 'in_app'
                 CHECK (type IN ('email','sms','in_app')),
  subject      VARCHAR(255),
  message      TEXT NOT NULL,
  is_read      BOOLEAN DEFAULT FALSE,
  sent_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)      REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE SET NULL
);

-- ============================================================
-- TABLE 7: REPORTS
-- ============================================================
CREATE TABLE reports (
  id            SERIAL PRIMARY KEY,
  generated_by  INT NOT NULL,
  report_type   VARCHAR(20) NOT NULL
                  CHECK (report_type IN ('weekly','monthly','quarterly','custom')),
  title         VARCHAR(255),
  file_url      VARCHAR(500),
  date_from     DATE,
  date_to       DATE,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (generated_by) REFERENCES users(id)
);

-- ============================================================
-- TABLE 8: AI LOGS
-- ============================================================
CREATE TABLE ai_logs (
  id              SERIAL PRIMARY KEY,
  complaint_id    INT NOT NULL,
  input_text      TEXT,
  predicted_cat   VARCHAR(50),
  predicted_pri   VARCHAR(20),
  confidence      DECIMAL(5,4),
  model_version   VARCHAR(50),
  processed_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_complaints_citizen  ON complaints(citizen_id);
CREATE INDEX idx_complaints_status   ON complaints(status);
CREATE INDEX idx_complaints_priority ON complaints(priority);
CREATE INDEX idx_complaints_category ON complaints(category);
CREATE INDEX idx_assignments_tech    ON assignments(technician_id);
CREATE INDEX idx_notif_user          ON notifications(user_id, is_read);

-- ============================================================
-- SEED DATA: USERS
-- password for all = "password" (bcrypt hash)
-- ============================================================
INSERT INTO users (id_number, full_name, email, password_hash, role, phone) VALUES
('24032135',  'Colette Ntsila', 'colette@smartcity.gov.za', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Citizen',       '0731234567'),
('240549913', 'Samson Zwane',   'samson@smartcity.gov.za',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Administrator', '0721234567'),
('240815419', 'Skosana SC',     'skosana@smartcity.gov.za', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Technician',    '0741234567'),
('240826011', 'Pale MM',        'pale@smartcity.gov.za',    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Councillor',    '0761234567'),
('240851130', 'Gumede B',       'gumede@smartcity.gov.za',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Citizen',       '0751234567');

-- ============================================================
-- SEED DATA: COMPLAINTS
-- ============================================================
INSERT INTO complaints
  (ref_id, citizen_id, category, description, address, latitude, longitude, status, priority, ai_category, ai_priority)
VALUES
('CMP-001', 1, 'water',
 'Large water leak on Main Street near bus stop 14. Water flooding the pavement.',
 '14 Main Street, CBD', -26.2041, 28.0473, 'In Progress', 'High', 'water', 'High'),
('CMP-002', 1, 'pothole',
 'Deep pothole on Nelson Mandela Drive causing vehicle damage.',
 'Nelson Mandela Drive, Soweto', -26.2650, 27.8590, 'Assigned', 'Medium', 'pothole', 'Medium'),
('CMP-003', 1, 'electricity',
 'Street lights out for 3 days on Vilakazi Street.',
 'Vilakazi Street, Orlando West', -26.2485, 27.8455, 'Resolved', 'Low', 'electricity', 'Low'),
('CMP-004', 5, 'sewage',
 'Sewage blockage causing overflow onto the street near community hall.',
 '5 Community Hall Road, Soweto', -26.2700, 27.8600, 'Submitted', 'Critical', 'sewage', 'Critical'),
('CMP-005', 5, 'facility',
 'Park benches and playground equipment in Joubert Park are broken.',
 'Joubert Park, Johannesburg', -26.1952, 28.0464, 'Classified', 'Low', 'facility', 'Low');

-- ============================================================
-- SEED DATA: ASSIGNMENTS
-- ============================================================
INSERT INTO assignments (complaint_id, technician_id, assigned_by, task_start_date, task_end_date, notes)
VALUES
(1, 3, 2, '2025-03-11', '2025-03-13', 'Urgent water leak. Bring pipe repair kit.'),
(2, 3, 2, '2025-03-13', '2025-03-15', 'Pothole repair. Bring asphalt team.');

-- ============================================================
-- SEED DATA: STATUS HISTORY
-- ============================================================
INSERT INTO status_history (complaint_id, changed_by, old_status, new_status, notes) VALUES
(1, 1, NULL,          'Submitted',   'Submitted by citizen'),
(1, 2, 'Submitted',   'Classified',  'AI classified as water/High'),
(1, 2, 'Classified',  'Assigned',    'Assigned to Skosana'),
(1, 3, 'Assigned',    'In Progress', 'Technician on site'),
(2, 1, NULL,          'Submitted',   'Submitted by citizen'),
(2, 2, 'Submitted',   'Classified',  'AI classified as pothole/Medium'),
(2, 2, 'Classified',  'Assigned',    'Assigned to Skosana'),
(3, 1, NULL,          'Submitted',   'Submitted by citizen'),
(3, 2, 'Submitted',   'Classified',  'AI classified as electricity/Low'),
(3, 2, 'Classified',  'Assigned',    'Assigned to technician'),
(3, 3, 'Assigned',    'In Progress', 'Replacing bulbs'),
(3, 3, 'In Progress', 'Resolved',    'All lights replaced and tested');

-- ============================================================
-- SEED DATA: ESCALATIONS
-- ============================================================
INSERT INTO escalations (complaint_id, councillor_id, escalated_by, escalation_type, decision, decision_notes)
VALUES
(1, 4, 2, 'auto', 'Direct Resources', 'Water department deploy crew within 24 hours.'),
(4, 4, 2, 'auto', 'Pending', NULL);

-- ============================================================
-- SEED DATA: RATINGS
-- ============================================================
UPDATE complaints SET rating = 4, rating_comment = 'Fixed quickly, thank you!' WHERE id = 3;

-- ============================================================
-- SEED DATA: NOTIFICATIONS
-- ============================================================
INSERT INTO notifications (user_id, complaint_id, type, subject, message, is_read) VALUES
(1, 1, 'in_app', 'Complaint Update',   'Your complaint CMP-001 is now In Progress.', FALSE),
(1, 2, 'in_app', 'Complaint Assigned', 'Your complaint CMP-002 has been assigned.',  TRUE),
(1, 3, 'in_app', 'Complaint Resolved', 'CMP-003 resolved. Please rate the service.', FALSE),
(3, 1, 'in_app', 'New Job Assigned',   'You have been assigned to CMP-001.',          FALSE),
(4, 1, 'in_app', 'Escalation Alert',   'High priority CMP-001 requires your review.', FALSE);

-- ============================================================
-- SEED DATA: AI LOGS
-- ============================================================
INSERT INTO ai_logs (complaint_id, input_text, predicted_cat, predicted_pri, confidence, model_version) VALUES
(1, 'Large water leak on Main Street near bus stop flooding pavement', 'water',       'High',     0.9521, 'nlp-v1.0'),
(2, 'Deep pothole on Nelson Mandela Drive causing vehicle damage',      'pothole',     'Medium',   0.9103, 'nlp-v1.0'),
(3, 'Street lights out for 3 days on Vilakazi Street',                  'electricity', 'Low',      0.8876, 'nlp-v1.0'),
(4, 'Sewage blockage overflow onto street near community hall',          'sewage',      'Critical', 0.9744, 'nlp-v1.0'),
(5, 'Park benches and playground equipment broken and dangerous',        'facility',    'Low',      0.8432, 'nlp-v1.0');

-- ============================================================
-- VIEWS
-- ============================================================
CREATE OR REPLACE VIEW v_complaints_full AS
SELECT
  c.id,
  c.ref_id,
  c.citizen_id,
  c.category,
  c.description,
  c.address,
  c.latitude,
  c.longitude,
  c.photo_url,
  c.status,
  c.priority,
  c.ai_category,
  c.ai_priority,
  c.admin_overridden,
  c.council_review_requested,
  c.rating,
  c.rating_comment,
  c.created_at,
  u.full_name  AS citizen_name,
  u.email      AS citizen_email,
  u.phone      AS citizen_phone
FROM complaints c
JOIN users u ON c.citizen_id = u.id;

CREATE OR REPLACE VIEW v_active_assignments AS
SELECT
  a.id AS assignment_id,
  c.ref_id, c.category, c.status, c.priority, c.address,
  t.full_name  AS technician_name,
  t.email      AS technician_email,
  a.task_start_date, a.task_end_date, a.assigned_at
FROM assignments a
JOIN complaints c ON a.complaint_id = c.id
JOIN users t      ON a.technician_id = t.id
WHERE c.status NOT IN ('Resolved');

CREATE OR REPLACE VIEW v_council_queue AS
SELECT
  e.id AS escalation_id,
  c.ref_id, c.category, c.priority, c.description,
  c.address, c.latitude, c.longitude,
  e.escalation_type, e.decision,
  e.escalated_at, e.decided_at,
  cit.full_name  AS citizen_name,
  coun.full_name AS councillor_name
FROM escalations e
JOIN complaints c  ON e.complaint_id  = c.id
JOIN users cit     ON c.citizen_id    = cit.id
JOIN users coun    ON e.councillor_id = coun.id;

CREATE OR REPLACE VIEW v_category_stats AS
SELECT
  category,
  COUNT(*) AS total,
  SUM(CASE WHEN status = 'Resolved'  THEN 1 ELSE 0 END) AS resolved,
  SUM(CASE WHEN status != 'Resolved' THEN 1 ELSE 0 END) AS active,
  ROUND(AVG(rating)::NUMERIC, 1)                         AS avg_rating,
  SUM(CASE WHEN priority = 'Critical' THEN 1 ELSE 0 END) AS critical_count,
  SUM(CASE WHEN priority = 'High'     THEN 1 ELSE 0 END) AS high_count
FROM complaints
GROUP BY category;
