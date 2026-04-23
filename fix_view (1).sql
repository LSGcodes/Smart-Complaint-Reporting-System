-- ============================================================
-- FIX 1: Run this SQL in phpMyAdmin to fix the view
-- The old view was missing citizen_id in SELECT
-- ============================================================

USE sql7820420;  -- Replace with your actual database name

DROP VIEW IF EXISTS v_complaints_full;

CREATE VIEW v_complaints_full AS
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
