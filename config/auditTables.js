const VALID_TABLES = [
  'users', 'employees', 'departments', 'positions',
  'employment_records', 'compensation_records', 'employee_government_ids',
  'attendance_logs', 'leave_types', 'leave_requests', 'leave_credits', 'leave_ledger',
  'overtime_requests', 'tasks', 'task_comments',
  'announcements', 'events', 'event_types', 'event_participants',
  'pay_periods', 'payslips', 'payslip_line_items',
  'employee_documents', 'document_types', 'document_acknowledgements',
  'notifications', 'feedback', 'recognitions',
  'surveys', 'survey_responses',
  'goals', 'kpis', 'performance_evaluations', 'performance_appraisals',
  'work_schedules', 'work_schedule_days',
  'roles', 'modules', 'role_permissions',
  'hr_policies', 'approval_workflows', 'audit_logs',
];

const REDACTED_FIELDS = [
  'password', 'password_hash', 'token', 'refresh_token',
  'basic_salary', 'daily_rate', 'hourly_rate',
  'sss_contribution', 'philhealth_contribution', 'pagibig_contribution',
  'withholding_tax', 'avatar_url', 'avatar_path',
];

module.exports = { VALID_TABLES, REDACTED_FIELDS };
