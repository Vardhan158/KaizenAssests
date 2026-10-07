/**
 * KaizenX Mobile Gate Pass & AMS/WMS Data Models
 * Strictly aligns with PRD Sections 20 & 31
 */

export type GatePassStatus =
  | "EXPECTED"
  | "AT_GATE"
  | "DOCUMENT_VERIFICATION"
  | "WAITING_FOR_DOCK"
  | "APPROVAL_REQUIRED"
  | "ENTRY_APPROVED"
  | "INSIDE_FACILITY"
  | "AT_DOCK"
  | "UNLOADING"
  | "QC_IN_PROGRESS"
  | "GRN_COMPLETED"
  | "PUTAWAY_COMPLETED"
  | "READY_FOR_EXIT"
  | "VEHICLE_EXITED";

export interface GatePassModel {
  gate_pass_id: string;
  gate_pass_number: string;
  gate_entry_id: string;
  supplier_id?: string;
  supplier_name: string;
  supplier_code?: string;
  supplier_contact?: string;
  po_id?: string;
  po_number?: string;
  po_date?: string;
  asn_id?: string;
  asn_number?: string;
  delivery_date?: string;
  vehicle_number: string;
  vehicle_type: "Truck" | "Container" | "Mini Truck" | "Trailer" | "Tanker" | "Other";
  vehicle_condition: "Normal" | "Damaged" | "Suspicious";
  transporter?: string;
  driver_id?: string;
  driver_name: string;
  driver_phone: string;
  driver_licence_number: string;
  driver_alt_contact?: string;
  transporter_emp_id?: string;
  driver_photo_uri?: string;
  invoice_number: string;
  invoice_date: string;
  invoice_amount?: string;
  invoice_photo_uri?: string;
  delivery_challan_number?: string;
  delivery_challan_date?: string;
  delivery_challan_photo_uri?: string;
  eway_bill_number?: string;
  eway_bill_valid_until?: string;
  eway_bill_expired?: boolean;
  eway_bill_photo_uri?: string;
  lr_number?: string;
  lr_date?: string;
  lr_photo_uri?: string;
  site_id: string;
  site_name: string;
  warehouse_id: string;
  warehouse_name: string;
  gate_id: string;
  gate_location: string;
  dock_id?: string;
  dock_number?: string;
  reporting_time?: string;
  dock_acknowledged?: boolean;
  entry_time: string;
  entry_security_user_id: string;
  entry_security_user_name: string;
  status: GatePassStatus;
  qr_token: string;
  vehicle_photo_uri?: string;
  remarks?: string;
  created_at: string;
  updated_at: string;
}

export interface SecurityUser {
  token: string;
  username: string;
  full_name: string;
  role: string;
  roles?: string[];
  company: string;
  site: string;
  site_id?: string;
  warehouse: string;
  warehouse_id?: string;
  gate_location: string;
  gate_id?: string;
  shift: string;
}

export interface DocumentChecklistItem {
  label: string;
  ok: boolean;
  warning?: boolean;
  detail: string;
}
