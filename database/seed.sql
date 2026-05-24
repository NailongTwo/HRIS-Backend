-- ADD SAMPLE USERS
INSERT INTO users (id, employee_no, username, email, password_hash, role) VALUES
(
  '11111111-1111-1111-1111-111111111111',
  'HS-002',
  'john.doe',
  'john.doe@highlysucceed.com',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  'Employee'
),
(
  '22222222-2222-2222-2222-222222222222',
  'HS-003',
  'jane.smith',
  'jane.smith@highlysucceed.com',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  'HR'
),
(
  '33333333-3333-3333-3333-333333333333',
  'HS-004',
  'bob.santos',
  'bob.santos@highlysucceed.com',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  'Employee'
)
ON CONFLICT (email) DO NOTHING;

-- ADD EMPLOYEES
INSERT INTO employees (id, user_id, employee_no, first_name, last_name, date_of_birth, gender, civil_status) VALUES
(
  'aaaa1111-1111-1111-1111-111111111111',
  '11111111-1111-1111-1111-111111111111',
  'HS-002',
  'John',
  'Doe',
  '1995-01-15',
  'Male',
  'Single'
),
(
  'aaaa2222-2222-2222-2222-222222222222',
  '22222222-2222-2222-2222-222222222222',
  'HS-003',
  'Jane',
  'Smith',
  '1993-05-20',
  'Female',
  'Single'
),
(
  'aaaa3333-3333-3333-3333-333333333333',
  '33333333-3333-3333-3333-333333333333',
  'HS-004',
  'Bob',
  'Santos',
  '1990-08-10',
  'Male',
  'Married'
)
ON CONFLICT (employee_no) DO NOTHING;

-- ADD EMPLOYMENT RECORDS
INSERT INTO employment_records (employee_id, position_id, department_id, employment_type, work_setup, hire_date, effective_date, required_time_in)
SELECT 
  'aaaa1111-1111-1111-1111-111111111111',
  p.id, d.id,
  'Full-Time', 'On-site',
  '2024-01-01', '2024-01-01', '08:00:00'
FROM positions p, departments d
WHERE p.code = 'DEV' AND d.code = 'IT';

INSERT INTO employment_records (employee_id, position_id, department_id, employment_type, work_setup, hire_date, effective_date, required_time_in)
SELECT 
  'aaaa2222-2222-2222-2222-222222222222',
  p.id, d.id,
  'Full-Time', 'On-site',
  '2023-06-01', '2023-06-01', '08:00:00'
FROM positions p, departments d
WHERE p.code = 'HRM' AND d.code = 'HR';

INSERT INTO employment_records (employee_id, position_id, department_id, employment_type, work_setup, hire_date, effective_date, required_time_in)
SELECT 
  'aaaa3333-3333-3333-3333-333333333333',
  p.id, d.id,
  'Full-Time', 'On-site',
  '2022-03-15', '2022-03-15', '08:00:00'
FROM positions p, departments d
WHERE p.code = 'FIN-OFF' AND d.code = 'FIN';

-- ADD LEAVE CREDITS FOR EMPLOYEES
INSERT INTO leave_credits (employee_id, leave_type_id, year, total_credits, used_credits, pending_credits)
SELECT 'aaaa1111-1111-1111-1111-111111111111', id, 2026, 15, 0, 0
FROM leave_types WHERE code IN ('VL', 'SL', 'EL')
ON CONFLICT DO NOTHING;

INSERT INTO leave_credits (employee_id, leave_type_id, year, total_credits, used_credits, pending_credits)
SELECT 'aaaa3333-3333-3333-3333-333333333333', id, 2026, 15, 0, 0
FROM leave_types WHERE code IN ('VL', 'SL', 'EL')
ON CONFLICT DO NOTHING;