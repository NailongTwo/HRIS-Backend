-- ==========================================
-- 5. Views
-- ==========================================

-- 5.1. v_employee_current_employment
-- Used by: Employee Directory & Dashboard
CREATE OR REPLACE VIEW v_employee_current_employment AS
SELECT 
    e.id AS employee_id,
    e.employee_no,
    e.first_name,
    e.last_name,
    e.avatar_url,
    e.status,
    er.id AS employment_record_id,
    er.department_id,
    er.position_id,
    p.title AS position_title,
    d.name AS department_name,
    er.employment_type,
    er.work_setup,
    er.hire_date,
    er.required_time_in,
    er.grace_period_mins,
    er.basic_salary,
    er.reports_to
FROM employees e
JOIN employment_records er ON e.id = er.employee_id
JOIN positions p ON er.position_id = p.id
JOIN departments d ON er.department_id = d.id
WHERE er.end_date IS NULL;

-- 5.2. v_leave_balance_current_year
-- Used by: My Leave & Dashboard
CREATE OR REPLACE VIEW v_leave_balance_current_year AS
SELECT 
    lc.employee_id,
    lt.name AS leave_type_name,
    lt.code AS leave_type_code,
    lt.badge_bg_color,
    lt.badge_text_color,
    lc.year,
    lc.total_credits,
    lc.carried_over,
    lc.used_credits,
    lc.pending_credits,
    (lc.total_credits + lc.carried_over - lc.used_credits - lc.pending_credits) AS available_credits
FROM leave_credits lc
JOIN leave_types lt ON lc.leave_type_id = lt.id
WHERE lc.year = EXTRACT(YEAR FROM CURRENT_DATE);

-- 5.3. v_pending_approvals
-- Used by: Admin Dashboard & Reports
CREATE OR REPLACE VIEW v_pending_approvals AS
SELECT 
    'Leave' AS request_type,
    lr.id AS request_id,
    lr.reference_no,
    lr.employee_id,
    e.first_name || ' ' || e.last_name AS employee_name,
    lr.start_date AS start_date,
    lr.end_date AS end_date,
    lr.total_days AS quantity,
    lr.status,
    lr.submitted_at
FROM leave_requests lr
JOIN employees e ON lr.employee_id = e.id
WHERE lr.status = 'Pending'
UNION ALL
SELECT 
    'Overtime' AS request_type,
    ot.id AS request_id,
    ot.reference_no,
    ot.employee_id,
    e.first_name || ' ' || e.last_name AS employee_name,
    ot.ot_date AS start_date,
    ot.ot_date AS end_date,
    ot.planned_hours AS quantity,
    ot.status,
    ot.submitted_at
FROM overtime_requests ot
JOIN employees e ON ot.employee_id = e.id
WHERE ot.status = 'Pending';

-- 5.4. v_attendance_monthly_summary
-- Used by: Reports: Attendance Summary
CREATE OR REPLACE VIEW v_attendance_monthly_summary AS
SELECT 
    employee_id,
    EXTRACT(YEAR FROM log_date) AS year,
    EXTRACT(MONTH FROM log_date) AS month,
    COUNT(CASE WHEN flag = 'On Time' THEN 1 END) AS on_time_days,
    COUNT(CASE WHEN flag = 'Late' THEN 1 END) AS late_days,
    COUNT(CASE WHEN flag = 'Absent' THEN 1 END) AS absent_days,
    COUNT(CASE WHEN flag = 'On Leave' THEN 1 END) AS leave_days,
    COUNT(CASE WHEN flag = 'Half Day' THEN 1 END) AS half_days,
    SUM(hours_worked) AS total_hours_worked,
    SUM(late_mins) AS total_late_mins,
    SUM(undertime_mins) AS total_undertime_mins
FROM attendance_logs
GROUP BY employee_id, EXTRACT(YEAR FROM log_date), EXTRACT(MONTH FROM log_date);

-- ==========================================
-- 6. Triggers
-- ==========================================

-- 6.1. fn_set_updated_at
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
DO $$
DECLARE
    t_name text;
BEGIN
    FOR t_name IN
        SELECT table_name FROM information_schema.columns WHERE column_name = 'updated_at' AND table_schema = 'public'
    LOOP
        EXECUTE format('CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();', t_name);
    END LOOP;
END;
$$;

-- 6.2. fn_close_prev_employment
CREATE OR REPLACE FUNCTION fn_close_prev_employment()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE employment_records
    SET end_date = NEW.effective_date - INTERVAL '1 day'
    WHERE employee_id = NEW.employee_id 
      AND end_date IS NULL 
      AND id != NEW.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_close_prev_employment
AFTER INSERT ON employment_records
FOR EACH ROW EXECUTE FUNCTION fn_close_prev_employment();

-- 6.3. fn_close_prev_compensation
CREATE OR REPLACE FUNCTION fn_close_prev_compensation()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE compensation_records
    SET end_date = NEW.effective_date - INTERVAL '1 day'
    WHERE employee_id = NEW.employee_id 
      AND end_date IS NULL 
      AND id != NEW.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_close_prev_compensation
AFTER INSERT ON compensation_records
FOR EACH ROW EXECUTE FUNCTION fn_close_prev_compensation();

-- 6.4. fn_update_leave_credits_on_approval
CREATE OR REPLACE FUNCTION fn_update_leave_credits_on_approval()
RETURNS TRIGGER AS $$
BEGIN
    -- Only act if status changes
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        -- Pending -> Approved
        IF OLD.status = 'Pending' AND NEW.status = 'Approved' THEN
            UPDATE leave_credits 
            SET pending_credits = pending_credits - NEW.total_days,
                used_credits = used_credits + NEW.total_days
            WHERE id = NEW.leave_credit_id;
            
        -- Pending -> Cancelled/Rejected
        ELSIF OLD.status = 'Pending' AND NEW.status IN ('Cancelled', 'Rejected') THEN
            UPDATE leave_credits 
            SET pending_credits = pending_credits - NEW.total_days
            WHERE id = NEW.leave_credit_id;
            
        -- Approved -> Cancelled/Rejected/Recalled
        ELSIF OLD.status = 'Approved' AND NEW.status IN ('Cancelled', 'Rejected', 'Recalled') THEN
            UPDATE leave_credits 
            SET used_credits = used_credits - NEW.total_days
            WHERE id = NEW.leave_credit_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_leave_credits_on_approval
AFTER UPDATE OF status ON leave_requests
FOR EACH ROW EXECUTE FUNCTION fn_update_leave_credits_on_approval();

-- Trigger for initial insert (Pending -> adds to pending_credits)
CREATE OR REPLACE FUNCTION fn_add_pending_leave_credits()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'Pending' AND NEW.leave_credit_id IS NOT NULL THEN
        UPDATE leave_credits 
        SET pending_credits = pending_credits + NEW.total_days
        WHERE id = NEW.leave_credit_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_add_pending_leave_credits
AFTER INSERT ON leave_requests
FOR EACH ROW EXECUTE FUNCTION fn_add_pending_leave_credits();

-- 6.5. fn_archive_old_doc_versions
CREATE OR REPLACE FUNCTION fn_archive_old_doc_versions()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE employee_documents
    SET is_current = false
    WHERE employee_id = NEW.employee_id
      AND document_type_id = NEW.document_type_id
      AND id != NEW.id
      AND is_current = true;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_archive_old_doc_versions
BEFORE INSERT ON employee_documents
FOR EACH ROW EXECUTE FUNCTION fn_archive_old_doc_versions();
