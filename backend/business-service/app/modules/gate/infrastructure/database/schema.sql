-- =============================================================================
-- PostgreSQL Database Schema for Gate Entry Module
-- Features: Gate Entries, Purchase Orders, Document OCR Results, Field Mismatches
-- =============================================================================

-- 1. Purchase Orders Master Table
CREATE TABLE IF NOT EXISTS purchase_orders (
    po_number VARCHAR(50) PRIMARY KEY,
    supplier_name VARCHAR(255) NOT NULL,
    material_description TEXT NOT NULL,
    total_quantity NUMERIC(12, 2) NOT NULL,
    po_date DATE NOT NULL,
    delivery_date DATE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Gate Entries Master Table
CREATE TABLE IF NOT EXISTS gate_entries (
    id VARCHAR(50) PRIMARY KEY,
    gate_entry_number VARCHAR(50) UNIQUE NOT NULL,
    vehicle_plate VARCHAR(50) NOT NULL,
    po_number VARCHAR(50) REFERENCES purchase_orders(po_number) ON DELETE SET NULL,
    po_id VARCHAR(50),
    status VARCHAR(50) NOT NULL,
    created_by VARCHAR(100) NOT NULL,
    verified_by VARCHAR(100),
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Document OCR Results Audit Table
CREATE TABLE IF NOT EXISTS gate_entry_ocr_results (
    id SERIAL PRIMARY KEY,
    gate_entry_id VARCHAR(50) NOT NULL REFERENCES gate_entries(id) ON DELETE CASCADE,
    extracted_po_number VARCHAR(50),
    supplier_name VARCHAR(255),
    material_description TEXT,
    total_quantity NUMERIC(12, 2),
    po_date DATE,
    delivery_date DATE,
    confidence NUMERIC(5, 4),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. 6-Field Automated Mismatches Audit Table
CREATE TABLE IF NOT EXISTS gate_entry_field_mismatches (
    id SERIAL PRIMARY KEY,
    gate_entry_id VARCHAR(50) NOT NULL REFERENCES gate_entries(id) ON DELETE CASCADE,
    field_name VARCHAR(100) NOT NULL,
    extracted_value TEXT,
    canonical_value TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for Performant Queries
CREATE INDEX IF NOT EXISTS idx_gate_entries_vehicle_plate ON gate_entries(vehicle_plate);
CREATE INDEX IF NOT EXISTS idx_gate_entries_po_number ON gate_entries(po_number);
CREATE INDEX IF NOT EXISTS idx_gate_entries_status ON gate_entries(status);

-- Seed Sample Purchase Orders for Testing
INSERT INTO purchase_orders (po_number, supplier_name, material_description, total_quantity, po_date, delivery_date, status)
VALUES 
('PO-1001', 'Rolls-Royce Power Systems', 'Transformer Cores', 12.00, '2026-08-01', '2026-08-15', 'OPEN'),
('PO-1002', 'Bosch Logistics India', 'Braking Modules', 50.00, '2026-08-05', '2026-08-20', 'OPEN'),
('PO-1003', 'Tata Auto Components Ltd.', 'Engine Mounting Brackets', 250.00, '2026-08-10', '2026-08-25', 'OPEN')
ON CONFLICT (po_number) DO NOTHING;


