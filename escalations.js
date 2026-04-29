const express = require('express');
const router  = express.Router();
const db      = require('../db');
const auth    = require('../middleware/auth');

/* ── Ensure escalations table exists ─────────────────────────── */
const ensureTable = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS escalations (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      complaint_id     INT NOT NULL,
      councillor_id    INT NOT NULL,
      escalation_type  VARCHAR(50)  DEFAULT 'admin_escalation',
      decision         VARCHAR(100) DEFAULT 'Pending',
      decision_notes   TEXT,
      escalated_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
      decided_at       DATETIME     NULL,
      FOREIGN KEY (complaint_id)  REFERENCES complaints(id)  ON DELETE CASCADE,
      FOREIGN KEY (councillor_id) REFERENCES users(id)       ON DELETE CASCADE
    )
  `);
};

/* ── GET /api/escalations ─────────────────────────────────────── */
router.get('/', auth, async (req, res) => {
  try {
    await ensureTable();
    const [rows] = await db.query(`
      SELECT
        e.id            AS escalation_id,
        e.complaint_id,
        e.councillor_id,
        e.escalation_type,
        e.decision,
        e.decision_notes,
        e.escalated_at,
        e.decided_at,
        c.ref_id,
        c.category,
        c.description,
        c.address,
        c.latitude,
        c.longitude,
        c.priority,
        c.status,
        u.full_name     AS citizen_name
      FROM escalations e
      JOIN complaints  c ON e.complaint_id  = c.id
      JOIN users       u ON c.user_id       = u.id
      ORDER BY e.escalated_at DESC
    `);
    return res.json({ success: true, escalations: rows });
  } catch (err) {
    console.error('GET /api/escalations error:', err.message);
    return res.json({ success: false, message: 'Failed to fetch escalations: ' + err.message });
  }
});

/* ── POST /api/escalations ────────────────────────────────────── */
router.post('/', auth, async (req, res) => {
  try {
    await ensureTable();

    let { complaint_id, councillor_id } = req.body;

    if (!complaint_id)  return res.json({ success: false, message: 'complaint_id is required.' });
    if (!councillor_id) return res.json({ success: false, message: 'councillor_id is required.' });

    complaint_id  = parseInt(complaint_id,  10);
    councillor_id = parseInt(councillor_id, 10);

    if (isNaN(complaint_id))  return res.json({ success: false, message: 'complaint_id must be a valid number.' });
    if (isNaN(councillor_id)) return res.json({ success: false, message: 'councillor_id must be a valid number.' });

    const [compRows] = await db.query(
      'SELECT id, user_id, ref_id, priority FROM complaints WHERE id = ?',
      [complaint_id]
    );
    if (!compRows.length) {
      return res.json({ success: false, message: `Complaint #${complaint_id} not found in database.` });
    }

    const [councilRows] = await db.query(
      "SELECT id, full_name FROM users WHERE id = ? AND role = 'Councillor'",
      [councillor_id]
    );
    if (!councilRows.length) {
      return res.json({ success: false, message: `User #${councillor_id} is not a registered Councillor.` });
    }

    const [existing] = await db.query(
      'SELECT id FROM escalations WHERE complaint_id = ?',
      [complaint_id]
    );
    if (existing.length > 0) {
      return res.json({
        success: false,
        message: `${compRows[0].ref_id} has already been escalated to a Councillor.`
      });
    }

    const escalation_type = compRows[0].user_id === req.user.id
      ? 'citizen_request'
      : 'admin_escalation';

    await db.query(
      `INSERT INTO escalations (complaint_id, councillor_id, escalation_type, decision, escalated_at)
       VALUES (?, ?, ?, 'Pending', NOW())`,
      [complaint_id, councillor_id, escalation_type]
    );

    await db.query(
      "UPDATE complaints SET status = 'In Progress', updated_at = NOW() WHERE id = ?",
      [complaint_id]
    );

    return res.json({
      success: true,
      message: `${compRows[0].ref_id} escalated to ${councilRows[0].full_name}.`
    });

  } catch (err) {
    console.error('POST /api/escalations error:', err.message);
    return res.json({ success: false, message: 'Server error during escalation: ' + err.message });
  }
});

/* ── PATCH /api/escalations/:id/decision ─────────────────────── */
router.patch('/:id/decision', auth, async (req, res) => {
  try {
    if (req.user.role !== 'Councillor') {
      return res.status(403).json({ success: false, message: 'Only Councillors can log decisions.' });
    }
    const { decision, decision_notes } = req.body;
    if (!decision) return res.json({ success: false, message: 'decision field is required.' });

    const escalationId = parseInt(req.params.id, 10);
    if (isNaN(escalationId)) {
      return res.json({ success: false, message: 'Invalid escalation ID.' });
    }

    const [result] = await db.query(
      'UPDATE escalations SET decision=?, decision_notes=?, decided_at=NOW() WHERE id=?',
      [decision, decision_notes || null, escalationId]
    );

    if (result.affectedRows === 0) {
      return res.json({ success: false, message: 'Escalation record not found.' });
    }
    return res.json({ success: true, message: 'Council decision recorded.' });

  } catch (err) {
    console.error('PATCH /api/escalations/:id/decision error:', err.message);
    return res.json({ success: false, message: 'Failed to record decision: ' + err.message });
  }
});

/* ── POST /api/escalations/request-review (citizen) ──────────── */
router.post('/request-review', auth, async (req, res) => {
  try {
    await ensureTable();

    const complaint_id = parseInt(req.body.complaint_id, 10);
    if (!req.body.complaint_id) return res.json({ success: false, message: 'complaint_id is required.' });
    if (isNaN(complaint_id))    return res.json({ success: false, message: 'complaint_id must be a valid number.' });

    const [councillors] = await db.query(
      "SELECT id FROM users WHERE role = 'Councillor' LIMIT 1"
    );
    if (!councillors.length) {
      return res.json({ success: false, message: 'No Councillor account found in the system.' });
    }

    const [existing] = await db.query(
      'SELECT id FROM escalations WHERE complaint_id = ?', [complaint_id]
    );
    if (existing.length > 0) {
      return res.json({ success: false, message: 'This complaint has already been escalated.' });
    }

    await db.query(
      `INSERT INTO escalations (complaint_id, councillor_id, escalation_type, decision, escalated_at)
       VALUES (?, ?, 'citizen_request', 'Pending', NOW())`,
      [complaint_id, councillors[0].id]
    );

    await db.query(
      'UPDATE complaints SET council_review_requested=1, updated_at=NOW() WHERE id=?',
      [complaint_id]
    );

    return res.json({ success: true, message: 'Council review requested.' });

  } catch (err) {
    console.error('POST /api/escalations/request-review error:', err.message);
    return res.json({ success: false, message: 'Failed to request review: ' + err.message });
  }
});

module.exports = router;
