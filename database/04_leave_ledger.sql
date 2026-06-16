CREATE TABLE IF NOT EXISTS leave_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id),
    leave_type_id UUID NOT NULL REFERENCES leave_types(id),
    transaction_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('Allocation','Usage','Adjustment','CarryOver','Expiry')),
    amount NUMERIC(6,1) NOT NULL,
    balance_after NUMERIC(6,1) NOT NULL,
    remarks TEXT,
    performed_by UUID REFERENCES users(id),
    reference_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_employee_type 
    ON leave_ledger(employee_id, leave_type_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_ledger_type 
    ON leave_ledger(transaction_type);

ALTER TABLE leave_policies 
    ADD COLUMN IF NOT EXISTS max_carry_over NUMERIC(5,1),
    ADD COLUMN IF NOT EXISTS carry_over_expiry_months SMALLINT,
    ADD COLUMN IF NOT EXISTS allow_negative_balance BOOLEAN NOT NULL DEFAULT false;
