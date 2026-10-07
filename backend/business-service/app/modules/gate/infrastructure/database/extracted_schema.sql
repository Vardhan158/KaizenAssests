-- =============================================================================
-- PostgreSQL Database Schema Extracted from:
-- C:\Users\a\Downloads\ams-wms-platform_till gateentry\...\app\modules\gate_entry & notification
-- Tables: advance_shipping_notice, gate_entry, notification_schedule, notification, purchase_orders
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Advance Shipping Notice (ASN) Table
CREATE TABLE IF NOT EXISTS advance_shipping_notice (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_order_id UUID NOT NULL,
    asn_number VARCHAR(50) NOT NULL UNIQUE,
    vendor_id UUID NOT NULL,
    expected_delivery_date TIMESTAMP WITH TIME ZONE NOT NULL,
    vehicle_number VARCHAR(30) NOT NULL,
    driver_name VARCHAR(100) NOT NULL,
    driver_phone VARCHAR(20) NOT NULL,
    status VARCHAR(30) NOT NULL,
    remarks VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS ix_asn_po_id ON advance_shipping_notice(purchase_order_id);
CREATE INDEX IF NOT EXISTS ix_asn_status ON advance_shipping_notice(status);

-- 2. Gate Entry Master Table
CREATE TABLE IF NOT EXISTS gate_entry (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asn_id UUID NOT NULL REFERENCES advance_shipping_notice(id) ON DELETE CASCADE,
    gate_entry_number VARCHAR(50) NOT NULL UNIQUE,
    vehicle_number VARCHAR(30) NOT NULL,
    security_user_id UUID NOT NULL,
    entry_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    remarks VARCHAR(500),
    status VARCHAR(30) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS ix_gate_entry_asn_id ON gate_entry(asn_id);
CREATE INDEX IF NOT EXISTS ix_gate_entry_status ON gate_entry(status);

-- 3. Notification Schedule Table
CREATE TABLE IF NOT EXISTS notification_schedule (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asn_id UUID NOT NULL REFERENCES advance_shipping_notice(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    notify_before_days INTEGER NOT NULL,
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(30) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_notification_schedule_asn_id ON notification_schedule(asn_id);
CREATE INDEX IF NOT EXISTS ix_notification_schedule_user_id ON notification_schedule(user_id);

-- 4. Notification Table
CREATE TABLE IF NOT EXISTS notification (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asn_id UUID NOT NULL REFERENCES advance_shipping_notice(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    title VARCHAR(150) NOT NULL,
    message VARCHAR(500) NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(30) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_notification_asn_id ON notification(asn_id);
CREATE INDEX IF NOT EXISTS ix_notification_user_id ON notification(user_id);

-- 5. Purchase Orders Master Table (Integrated for PO OCR Verification)
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

-- Seed Sample PO Data
INSERT INTO purchase_orders (po_number, supplier_name, material_description, total_quantity, po_date, delivery_date, status)
VALUES 
('PO-1001', 'Rolls-Royce Power Systems', 'Transformer Cores', 12.00, '2026-08-01', '2026-08-15', 'OPEN'),
('PO-1002', 'Bosch Logistics India', 'Braking Modules', 50.00, '2026-08-05', '2026-08-20', 'OPEN')
ON CONFLICT (po_number) DO NOTHING;
