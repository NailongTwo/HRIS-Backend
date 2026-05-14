CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS citext;

-- Enums
CREATE TYPE gender_type AS ENUM ('Male', 'Female', 'Non-Binary', 'Prefer Not to Say');
CREATE TYPE civil_status_type AS ENUM ('Single', 'Married', 'Widowed', 'Separated', 'Annulled');
CREATE TYPE employment_type AS ENUM ('Full-Time', 'Part-Time', 'Contractual', 'Probationary', 'Project-Based', 'Internship');
CREATE TYPE work_setup_type AS ENUM ('On-site', 'Remote', 'Hybrid');
CREATE TYPE employee_status_type AS ENUM ('Active', 'Inactive', 'Resigned', 'Terminated', 'On Leave', 'Retired');
CREATE TYPE approval_status_type AS ENUM ('Pending', 'Approved', 'Rejected', 'Cancelled', 'Recalled');
CREATE TYPE leave_type_name AS ENUM ('Vacation Leave', 'Sick Leave', 'Emergency Leave', 'Maternity Leave', 'Paternity Leave', 'Bereavement Leave', 'Solo Parent Leave', 'VAWC Leave', 'Magna Carta Leave');
CREATE TYPE overtime_day_type AS ENUM ('Regular Day', 'Rest Day', 'Holiday', 'Special Holiday');
CREATE TYPE attendance_source AS ENUM ('Biometric', 'Manual', 'System', 'Wearable');
CREATE TYPE attendance_flag AS ENUM ('On Time', 'Late', 'Undertime', 'Absent', 'Half Day', 'Holiday', 'On Leave', 'Work From Home');
CREATE TYPE document_status_type AS ENUM ('Complete', 'Pending', 'For Renewal', 'Expired');
CREATE TYPE doc_category_type AS ENUM ('Pre-Employment', 'Government ID', 'Company Issuance', 'Performance', 'Disciplinary', 'Training', 'Medical', 'Other');
CREATE TYPE payslip_period_type AS ENUM ('1st Half', '2nd Half');
CREATE TYPE task_status_type AS ENUM ('To Do', 'In Progress', 'Done', 'Cancelled');
CREATE TYPE task_priority_type AS ENUM ('Low', 'Medium', 'High', 'Critical');
CREATE TYPE event_visibility_type AS ENUM ('All', 'Department', 'Specific Employees');
CREATE TYPE notification_type AS ENUM ('Leave', 'Overtime', 'Attendance', 'Payroll', 'Document', 'Task', 'Event', 'System', 'Announcement');
CREATE TYPE audit_action_type AS ENUM ('INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'APPROVE', 'REJECT', 'UPLOAD', 'ACKNOWLEDGE');
CREATE TYPE user_role_type AS ENUM ('Admin', 'HR', 'Manager', 'Employee', 'Payroll', 'Super Admin');
CREATE TYPE benefit_type AS ENUM ('HMO', 'Life Insurance', 'Dental', 'Vision', 'Accident Insurance', 'Other');
CREATE TYPE gov_id_type AS ENUM ('SSS', 'PhilHealth', 'Pag-IBIG', 'TIN', 'PhilSys', 'UMID', 'Passport', 'Driver License', 'Voter ID', 'Other');

-- 1. Organizational Structure
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    head_employee_id UUID, -- Foreign Key will be added later due to circular dependency
    parent_dept_id UUID REFERENCES departments(id),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    title VARCHAR(150) NOT NULL,
    department_id UUID NOT NULL REFERENCES departments(id),
    level SMALLINT NOT NULL DEFAULT 1,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. User Authentication & RBAC
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_no VARCHAR(20) UNIQUE,
    username VARCHAR(50) UNIQUE NOT NULL,
    email CITEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role user_role_type NOT NULL DEFAULT 'Employee',
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_locked BOOLEAN NOT NULL DEFAULT false,
    failed_attempts SMALLINT NOT NULL DEFAULT 0,
    last_login_at TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ,
    must_change_password BOOLEAN NOT NULL DEFAULT false,
    refresh_token_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    refresh_token_hash TEXT NOT NULL,
    ip_address INET,
    user_agent TEXT,
    device_type VARCHAR(30),
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Employee Master Data
CREATE TABLE employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id),
    employee_no VARCHAR(20) UNIQUE NOT NULL,
    first_name VARCHAR(80) NOT NULL,
    middle_name VARCHAR(80),
    last_name VARCHAR(80) NOT NULL,
    suffix VARCHAR(10),
    preferred_name VARCHAR(80),
    date_of_birth DATE NOT NULL,
    gender gender_type NOT NULL,
    civil_status civil_status_type NOT NULL,
    nationality VARCHAR(80) NOT NULL DEFAULT 'Filipino',
    religion VARCHAR(80),
    personal_email CITEXT,
    personal_phone VARCHAR(20),
    perm_street VARCHAR(200),
    perm_barangay VARCHAR(100),
    perm_city VARCHAR(100),
    perm_province VARCHAR(100),
    perm_zip_code VARCHAR(10),
    perm_country VARCHAR(80) NOT NULL DEFAULT 'Philippines',
    curr_street VARCHAR(200),
    curr_barangay VARCHAR(100),
    curr_city VARCHAR(100),
    curr_province VARCHAR(100),
    curr_zip_code VARCHAR(10),
    curr_country VARCHAR(80) NOT NULL DEFAULT 'Philippines',
    avatar_url TEXT,
    status employee_status_type NOT NULL DEFAULT 'Active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Alter departments now that employees exists
ALTER TABLE departments ADD CONSTRAINT fk_departments_head FOREIGN KEY (head_employee_id) REFERENCES employees(id);

CREATE TABLE emergency_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id),
    name VARCHAR(150) NOT NULL,
    relationship VARCHAR(50) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email CITEXT,
    address TEXT,
    is_primary BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE employee_government_ids (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id),
    id_type gov_id_type NOT NULL,
    id_number VARCHAR(50) NOT NULL,
    issued_date DATE,
    expiry_date DATE,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, id_type)
);

CREATE TABLE employee_benefits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id),
    benefit_type benefit_type NOT NULL,
    provider VARCHAR(100) NOT NULL,
    policy_number VARCHAR(100) NOT NULL,
    coverage_amount NUMERIC(14,2),
    coverage_period VARCHAR(20),
    effective_date DATE NOT NULL,
    expiry_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Employment Records
CREATE TABLE employment_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id),
    position_id UUID NOT NULL REFERENCES positions(id),
    department_id UUID NOT NULL REFERENCES departments(id),
    employment_type employment_type NOT NULL,
    work_setup work_setup_type NOT NULL DEFAULT 'On-site',
    reports_to UUID REFERENCES employees(id),
    effective_date DATE NOT NULL,
    end_date DATE,
    hire_date DATE NOT NULL,
    regularization_date DATE,
    separation_date DATE,
    required_time_in TIME,
    grace_period_mins SMALLINT NOT NULL DEFAULT 15,
    basic_salary NUMERIC(14,2),
    change_reason TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Compensation Records
CREATE TABLE compensation_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id),
    employment_record_id UUID REFERENCES employment_records(id),
    basic_salary NUMERIC(14,2) NOT NULL,
    hourly_rate NUMERIC(10,4),
    daily_rate NUMERIC(10,4),
    sss_contribution NUMERIC(10,2),
    philhealth_contribution NUMERIC(10,2),
    pagibig_contribution NUMERIC(10,2),
    withholding_tax NUMERIC(10,2),
    effective_date DATE NOT NULL,
    end_date DATE,
    change_reason TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Leave Management (Must be before Attendance for FK)
CREATE TABLE leave_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name leave_type_name UNIQUE NOT NULL,
    code VARCHAR(10) UNIQUE NOT NULL,
    description TEXT,
    is_paid BOOLEAN NOT NULL DEFAULT true,
    requires_approval BOOLEAN NOT NULL DEFAULT true,
    requires_attachment BOOLEAN NOT NULL DEFAULT false,
    min_days NUMERIC(4,1) NOT NULL DEFAULT 0.5,
    max_consecutive_days SMALLINT,
    carry_over BOOLEAN NOT NULL DEFAULT false,
    carry_over_max NUMERIC(4,1),
    badge_bg_color VARCHAR(7) DEFAULT '#EEF4FF',
    badge_text_color VARCHAR(7) DEFAULT '#2450A4',
    badge_dot_color VARCHAR(7) DEFAULT '#5082E0',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE leave_credits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id),
    leave_type_id UUID NOT NULL REFERENCES leave_types(id),
    year SMALLINT NOT NULL,
    total_credits NUMERIC(5,1) NOT NULL DEFAULT 0,
    used_credits NUMERIC(5,1) NOT NULL DEFAULT 0,
    pending_credits NUMERIC(5,1) NOT NULL DEFAULT 0,
    forfeited_credits NUMERIC(5,1) NOT NULL DEFAULT 0,
    carried_over NUMERIC(5,1) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE leave_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference_no VARCHAR(30) UNIQUE NOT NULL,
    employee_id UUID NOT NULL REFERENCES employees(id),
    leave_type_id UUID NOT NULL REFERENCES leave_types(id),
    leave_credit_id UUID REFERENCES leave_credits(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days NUMERIC(4,1) NOT NULL,
    is_half_day BOOLEAN NOT NULL DEFAULT false,
    half_day_period VARCHAR(10),
    reason TEXT,
    attachment_url TEXT,
    status approval_status_type NOT NULL DEFAULT 'Pending',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_by UUID REFERENCES employees(id),
    reviewed_at TIMESTAMPTZ,
    review_remarks TEXT,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    approval_remarks TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE leave_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    leave_type_id UUID NOT NULL REFERENCES leave_types(id),
    employment_type employment_type NOT NULL,
    annual_entitlement NUMERIC(5,1) NOT NULL DEFAULT 0,
    accrual_method VARCHAR(20) NOT NULL DEFAULT 'Lump Sum',
    waiting_period_days INTEGER NOT NULL DEFAULT 0,
    min_service_months SMALLINT NOT NULL DEFAULT 0,
    effective_date DATE NOT NULL,
    end_date DATE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Attendance
CREATE TABLE attendance_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id),
    log_date DATE NOT NULL,
    time_in TIMESTAMPTZ,
    time_out TIMESTAMPTZ,
    source attendance_source NOT NULL DEFAULT 'System',
    flag attendance_flag NOT NULL DEFAULT 'On Time',
    hours_worked NUMERIC(5,2),
    late_mins SMALLINT NOT NULL DEFAULT 0,
    undertime_mins SMALLINT NOT NULL DEFAULT 0,
    is_adjusted BOOLEAN NOT NULL DEFAULT false,
    adjustment_reason TEXT,
    adjusted_by UUID REFERENCES users(id),
    adjusted_at TIMESTAMPTZ,
    leave_request_id UUID REFERENCES leave_requests(id),
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Overtime
CREATE TABLE overtime_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference_no VARCHAR(30) UNIQUE NOT NULL,
    employee_id UUID NOT NULL REFERENCES employees(id),
    ot_date DATE NOT NULL,
    day_type overtime_day_type NOT NULL DEFAULT 'Regular Day',
    planned_start TIME NOT NULL,
    planned_end TIME NOT NULL,
    actual_start TIME,
    actual_end TIME,
    planned_hours NUMERIC(4,2) NOT NULL,
    actual_hours NUMERIC(4,2),
    reason TEXT NOT NULL,
    project_task TEXT,
    status approval_status_type NOT NULL DEFAULT 'Pending',
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_by UUID REFERENCES employees(id),
    reviewed_at TIMESTAMPTZ,
    review_remarks TEXT,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    approval_remarks TEXT,
    ot_rate_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.25,
    cancelled_at TIMESTAMPTZ,
    cancelled_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Payroll & Payslips
CREATE TABLE pay_periods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    period_label VARCHAR(50) NOT NULL,
    period_type payslip_period_type NOT NULL,
    year SMALLINT NOT NULL,
    month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    payment_date DATE,
    is_finalized BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE payslips (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reference_no VARCHAR(30) UNIQUE NOT NULL,
    employee_id UUID NOT NULL REFERENCES employees(id),
    pay_period_id UUID NOT NULL REFERENCES pay_periods(id),
    basic_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
    overtime_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
    holiday_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
    night_diff_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
    allowances NUMERIC(14,2) NOT NULL DEFAULT 0,
    other_earnings NUMERIC(14,2) NOT NULL DEFAULT 0,
    gross_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
    sss_deduction NUMERIC(14,2) NOT NULL DEFAULT 0,
    philhealth_deduction NUMERIC(14,2) NOT NULL DEFAULT 0,
    pagibig_deduction NUMERIC(14,2) NOT NULL DEFAULT 0,
    withholding_tax NUMERIC(14,2) NOT NULL DEFAULT 0,
    late_deduction NUMERIC(14,2) NOT NULL DEFAULT 0,
    absent_deduction NUMERIC(14,2) NOT NULL DEFAULT 0,
    other_deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
    total_deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
    net_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
    days_worked NUMERIC(4,1),
    days_absent NUMERIC(4,1),
    days_leave NUMERIC(4,1),
    ot_hours NUMERIC(5,2),
    late_mins_total SMALLINT,
    is_released BOOLEAN NOT NULL DEFAULT false,
    released_at TIMESTAMPTZ,
    pdf_url TEXT,
    generated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE payslip_line_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payslip_id UUID NOT NULL REFERENCES payslips(id),
    category VARCHAR(20) CHECK (category IN ('Earning', 'Deduction')),
    label VARCHAR(100) NOT NULL,
    amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    sort_order SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Tasks
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    assignee_id UUID NOT NULL REFERENCES employees(id),
    assigned_by UUID REFERENCES users(id),
    status task_status_type NOT NULL DEFAULT 'To Do',
    priority task_priority_type NOT NULL DEFAULT 'Medium',
    due_date DATE,
    start_date DATE,
    completed_at TIMESTAMPTZ,
    project VARCHAR(150),
    tags TEXT[],
    attachment_urls TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE task_comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES tasks(id),
    author_id UUID NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Calendar & Events
CREATE TABLE event_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(80) UNIQUE NOT NULL,
    color VARCHAR(7) NOT NULL DEFAULT '#F1C40F',
    icon VARCHAR(50),
    description TEXT,
    is_holiday BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type_id UUID NOT NULL REFERENCES event_types(id),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    location VARCHAR(200),
    start_datetime TIMESTAMPTZ NOT NULL,
    end_datetime TIMESTAMPTZ NOT NULL,
    is_all_day BOOLEAN NOT NULL DEFAULT false,
    is_recurring BOOLEAN NOT NULL DEFAULT false,
    recurrence_rule TEXT,
    visibility event_visibility_type NOT NULL DEFAULT 'All',
    target_dept_ids UUID[],
    created_by UUID NOT NULL REFERENCES users(id),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE event_participants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(id),
    employee_id UUID NOT NULL REFERENCES employees(id),
    rsvp_status VARCHAR(20) DEFAULT 'Pending' CHECK (rsvp_status IN ('Pending', 'Accepted', 'Declined')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Document Management
CREATE TABLE document_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category doc_category_type NOT NULL,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    description TEXT,
    is_required BOOLEAN NOT NULL DEFAULT false,
    requires_acknowledgement BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE employee_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id),
    document_type_id UUID NOT NULL REFERENCES document_types(id),
    file_name VARCHAR(255) NOT NULL,
    file_url TEXT NOT NULL,
    file_size_kb INTEGER,
    mime_type VARCHAR(80),
    version SMALLINT NOT NULL DEFAULT 1,
    is_current BOOLEAN NOT NULL DEFAULT true,
    issued_date DATE,
    expiry_date DATE,
    status document_status_type NOT NULL DEFAULT 'Pending',
    uploaded_by UUID NOT NULL REFERENCES users(id),
    remarks TEXT,
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE document_acknowledgements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id),
    document_id UUID NOT NULL REFERENCES employee_documents(id),
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT,
    signature_url TEXT
);

-- 13. System Tables
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient_id UUID NOT NULL REFERENCES users(id),
    type notification_type NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    action_url TEXT,
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    is_archived BOOLEAN NOT NULL DEFAULT false,
    sent_via_email BOOLEAN NOT NULL DEFAULT false,
    sent_via_sms BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    employee_id UUID REFERENCES employees(id),
    action audit_action_type NOT NULL,
    table_name VARCHAR(80),
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    changed_fields TEXT[],
    ip_address INET,
    user_agent TEXT,
    session_id VARCHAR(100),
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE hr_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    data_type VARCHAR(20) NOT NULL DEFAULT 'string',
    description TEXT,
    category VARCHAR(50),
    is_editable BOOLEAN NOT NULL DEFAULT true,
    last_updated_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE approval_workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    step SMALLINT NOT NULL DEFAULT 1,
    approver_id UUID NOT NULL REFERENCES users(id),
    status approval_status_type NOT NULL DEFAULT 'Pending',
    acted_at TIMESTAMPTZ,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
