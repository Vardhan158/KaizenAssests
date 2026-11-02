export type HelpContent = {
  title: string;
  purpose: string;
  instructions: string;
  rules?: string;
  example?: string;
  next: string;
};
const topic = (title: string, purpose: string, instructions: string, next: string, rules?: string, example?: string): HelpContent =>
  ({ title, purpose, instructions, next, rules, example });

export const informationHelp = {
  supplier: topic("Supplier dashboard", "Track deliveries and supplier actions.", "Review your ASN, damage claims and dispatch updates.", "Open the record that needs a response."),
  procurement: topic("Procurement references", "Connect receipts to purchasing records.", "Check the supplier and purchase-order reference against the delivery documents.", "Continue to ASN or receiving verification.", "Use an existing matching record when a purchase order is supplied.", "PO-2026-001"),
  asn: topic("Advance shipment notices", "Tell the warehouse which materials are arriving.", "Assign vehicle and driver details, select materials and enter shipped quantities.", "Submit the ASN for gate verification.", "Required transport details and valid positive material quantities must be supplied.", "KA02AH2755; 100 PCS"),
  materials: topic("Material master", "Identify materials consistently across receipts and production.", "Select the material code and its unit of measure before entering quantities.", "Use the saved material in an ASN or material request.", "Use the master unit when recording quantities.", "MAT-MILD-001; PCS"),
  gate: topic("Gate verification", "Record and verify an arriving vehicle.", "Match the ASN, vehicle, driver and delivery documents before approval.", "Send the approved entry for dock allocation.", "A vehicle cannot have conflicting active gate entries; use the existing pass for the same ASN.", "KA02AH2755"),
  gateExit: topic("Vehicle exit", "Record the physical departure of a vehicle.", "Check the gate pass and required receiving or loading completion before confirming exit.", "The gate visit closes after exit is recorded.", "Confirm only when the vehicle has physically left."),
  pickupGate: topic("Finished-goods pickup gate", "Manage supplier pickup entry and exit.", "Verify the pickup request, vehicle and driver; use the saved gate pass for exit.", "Assembly loads the vehicle after gate entry, then Security records exit.", "Loading requires the pickup vehicle to be inside the facility."),
  dock: topic("Dock allocation", "Assign the receiving dock to an approved vehicle.", "Configure the dock if needed, then allocate an available dock to a waiting gate entry.", "Continue unloading and GRN receiving.", "Occupied or maintenance docks cannot be allocated."),
  grn: topic("Goods receipt notes", "Record received material and its inspection outcome.", "Verify receipt details, reconcile quantities, save damage evidence and batch labels, then complete the GRN.", "Put away accepted stock and review damaged material separately.", "Accepted, damaged, rejected and held quantities must reconcile with the receipt."),
  qc: topic("Quality inspection", "Separate usable output from exceptions.", "Record accepted, rework, rejected and held quantities against the inspected output.", "Release accepted goods to the next warehouse or production stage.", "Do not count the same quantity in multiple outcomes."),
  availableStockKpi: topic("Available stock", "Total available stock shown by the warehouse inventory summary.", "Open Inventory to check each material, unit and storage location before picking or issuing.", "Reserve the required stock and confirm the physical pick.", "This is a stock quantity, not a count of materials or tasks.", "90 available units minus 10 picked units leaves 80 units."),
  putawayKpi: topic("Putaway to do", "Number of putaway tasks with PENDING or CREATED status.", "Open Putaway to scan the accepted material and destination bin.", "Confirm the quantity physically stored.", "This counts tasks, not units; total putaway must stay within the GRN accepted quantity."),
  requestsReviewKpi: topic("Requests to review", "Number of material requests waiting for warehouse review.", "Open Requisitions & Picking to review the requested materials and stock availability.", "Approve and reserve eligible stock for picking.", "Includes PENDING, SUBMITTED and PENDING_WAREHOUSE_APPROVAL requests."),
  picksCompleteKpi: topic("Picks to complete", "Number of picking tasks with PENDING or IN_PROGRESS status.", "Open Requisitions & Picking, scan the material and location, and enter the quantity physically picked.", "Confirm the pick to update stock and the task remainder.", "This counts open tasks, not the number of units remaining to pick."),
  warehouse: topic("Warehouse dashboard", "Monitor receipts, stock and material supply.", "Review pending putaway and assembly requests, then open the relevant queue.", "Complete physical movements using the material and location scans."),
  putaway: topic("Putaway", "Move accepted stock into a storage bin.", "Scan the material and destination bin, then enter the quantity physically stored.", "Confirmed stock becomes available at that location.", "Total putaway cannot exceed the GRN accepted quantity; partial putaways share that limit.", "80 accepted; 30 stored; 50 remain"),
  inventory: topic("Inventory", "Review physical stock and its location.", "Check material, warehouse, batch and available quantity before planning an issue.", "Reserve stock through a requisition or inspect its movement history.", "Reserved and quarantined quantities are not free stock."),
  requisitions: topic("Assembly requisitions and picking", "Approve assembly supply and confirm physical picks in one place.", "Review the requested quantities, approve or reserve stock, then scan and confirm the picking task below.", "Issue the confirmed material to Assembly.", "Remaining task quantity is the amount still to pick, not the warehouse stock balance.", "90 in stock; pick 10; stock becomes 80"),
  locations: topic("Zones and bins", "Define where physical stock is stored.", "Create a zone, add bins with rack and shelf details, then use their QR codes during movements.", "Assign or confirm putaway into an active bin.", "The first zone also requires warehouse details when setup is empty.", "ZONE-001; RACK-01; SHELF-01"),
  assembly: topic("Assembly operations", "Manage material supply and production progress.", "Review material availability and orders before starting the next operation.", "Complete production and send finished output for quality inspection."),
  production: topic("Production", "Record assembly progress against a production order.", "Check the target and supplied materials, then record the actual output and exceptions.", "Send the produced quantity for quality inspection.", "Enter actual quantities rather than the planned quantity when they differ."),
  finishedGoods: topic("Finished goods", "Review completed production and stock ready for dispatch.", "Check quality status, batch identity and available quantity.", "Allocate eligible stock to a dispatch request.", "Use stock that has passed the required quality checks."),
  dispatch: topic("Dispatch", "Prepare goods for supplier or customer pickup.", "Verify the request, pick and pack goods, then validate loading and gate exit.", "Security records physical exit after loading is complete.", "Packed, loaded and ordered quantities must match the required workflow checks."),
  supplierDispatch: topic("Supplier dispatch", "Request pickup of available finished goods.", "Choose the product and quantity, enter transport details and select the expected pickup date.", "Assembly processes the request; the vehicle checks in at the gate.", "Pickup date must be today or later and quantity must be available."),
  damage: topic("Damage returns", "Review damaged or rejected goods published from GRN.", "Inspect the material quantities and photos, then record the claim response or return resolution.", "Track the agreed replacement, return or closure.", "Respond only to claims belonging to the authenticated supplier."),
  notifications: topic("Notifications", "Review workflow updates requiring attention.", "Open an alert to inspect the related record and its current status.", "Complete the required action in the linked module."),
  reports: topic("Reports and exports", "Create a reviewable snapshot of operational records.", "Set the desired filters, verify the displayed records, then export, download or print.", "Review the exported document before sharing it.", "Exports reflect the records and filters selected at download time."),
  vehicle: topic("Vehicle number", "Identify the delivery vehicle.", "Enter the Indian registration; spaces and hyphens are accepted.", "Verify the same vehicle at the gate.", "ASN warehouses uppercase letters and digits without separators; invalid formats are rejected.", "KA02AH2755; KA-02-AH-2755; 22BH1234AA"),
  driver: topic("Driver name", "Identify the driver for vehicle verification.", "Enter the driver's name as used on the delivery documents.", "Confirm the driver at gate entry.", "ASN requires 2–100 characters with letters, spaces and standard name punctuation; numbers-only names are invalid.", "R. D'Souza"),
  mobile: topic("Driver contact", "Provide a mobile number for arrival coordination.", "Enter the 10-digit Indian mobile number without a country prefix.", "Use this contact if arrival details need clarification.", "ASN mobile numbers must start with 6–9; letters and invalid lengths are rejected.", "9876543210"),
  pickupDate: topic("Expected pickup date", "Plan the pickup calendar date.", "Choose today or a future date from the calendar.", "Submit the dispatch request with its transport details.", "A date is required; past, impossible and malformed dates are rejected.", "2026-10-22"),
  arrivalDate: topic("Expected arrival date", "Plan when the supplier vehicle should arrive.", "Select the expected warehouse arrival date.", "Submit the ASN for arrival verification.", "Use a valid date of today or later."),
  quantity: topic("Material quantity", "Record material in its master unit of measure.", "Enter a positive quantity for the selected material.", "Check the quantity against receipt, batch or request totals.", "ASN quantities support up to four decimal places; count units such as PCS require whole numbers.", "10 PCS; 2.5 KG"),
  reconciliation: topic("Quantity reconciliation", "Account for every received unit.", "Split received quantity into accepted, damaged, rejected and held outcomes.", "Create batches and put away only the accepted quantity.", "Outcome totals must equal received quantity; do not duplicate units.", "100 received = 80 accepted + 20 damaged"),
  reserved: topic("Reserved stock", "Show stock set aside for a specific request.", "Compare requested, available and reserved quantities before confirming an issue.", "Pick against the approved reservation.", "Reserved stock is not free to allocate to another request."),
  pickRemaining: topic("Remaining to pick", "Show the unconfirmed quantity on this picking task.", "Enter only the quantity physically picked and scan its material and location.", "The task remainder decreases and source stock is updated after confirmation.", "This is not the source-bin stock balance.", "Request 10, picked 4: 6 remain to pick"),
  qr: topic("Material and location QR", "Identify the exact material batch or storage location.", "Scan or upload the saved QR, then check the resolved record.", "Confirm the physical movement with the correct quantity.", "Use saved labels for the selected batch and assigned location."),
  packageQr: topic("Package QR", "Identify a saved package during loading.", "Use View Package QR to inspect, print or download the package label.", "Scan the same package QR to verify loading.", "A package number must be saved before a label is available."),
  loading: topic("Loading verification", "Confirm packed goods have physically entered the pickup vehicle.", "Verify the vehicle and driver, scan the package QR and check the loaded total.", "Confirm loading, then send the vehicle for gate exit.", "The vehicle must have a gate entry and loaded quantity must meet the packing checks."),
  workflowStatus: topic("Workflow status", "Show the last recorded stage for this operation.", "Open the record and review pending approvals or physical confirmations.", "Complete the next enabled workflow action.", "A displayed status does not replace a required scan or confirmation."),
  damageEvidence: topic("Damage evidence", "Document the damaged material for review.", "Enter the damage reason, capture a clear photo and save it against the material line.", "Review the evidence before completing GRN and sending the supplier claim.", "Damage quantity must be greater than zero; the image should show the actual material condition."),
  batch: topic("Batch allocations", "Keep accepted stock traceable through putaway and issue.", "Split accepted quantity into batches and use the saved batch QR labels.", "Complete GRN and scan the saved label during putaway.", "Batch totals must match the accepted quantity."),
  fifo: topic("Stock allocation priority", "Keep stock selection traceable and ordered.", "Review the suggested eligible batches and any required exception reason.", "Pick the approved batches from their recorded locations.", "Do not substitute batches without the required workflow approval."),
} satisfies Record<string, HelpContent>;
export type HelpId = keyof typeof informationHelp;

// Redirect-only routes retain their existing destination and use its page help.
export const pageHelp: Record<string, HelpId> = {
  "/supplier-dashboard": "supplier", "/supplier-materials": "materials",
  "/supplier/asns": "asn", "/supplier/asns/new": "asn", "/supplier/dispatch": "supplierDispatch",
  "/damage-claims": "damage", "/gate-dashboard": "gate", "/vehicle-queue": "gate",
  "/vehicle-exit": "gateExit", "/gate/finished-goods-pickup": "pickupGate",
  "/gate/finished-goods-pickup-exit": "gateExit", "/dock-management": "dock", "/dock-master": "dock",
  "/grn": "grn", "/receiving": "grn", "/inventory": "warehouse", "/putaway-tasks": "putaway",
  "/warehouse-dashboard": "warehouse", "/warehouse/materials": "inventory",
  "/warehouse/material-requests": "requisitions", "/warehouse/assembly-requisitions": "requisitions",
  "/warehouse/finished-goods-warehouse": "finishedGoods", "/warehouse/finished-goods-requests": "dispatch",
  "/assembly-dashboard": "assembly", "/assembly/requests": "assembly", "/assembly/material-requests": "requisitions",
  "/assembly/production": "production", "/assembly/quality": "qc", "/assembly/finished-goods": "finishedGoods",
  "/assembly/dispatch": "dispatch", "/dispatch-orders": "dispatch", "/dispatch-picking-packing": "dispatch",
  "/dispatch-loading": "loading", "/dispatch-gate-out": "gateExit", "/dispatch-exceptions": "dispatch",
  "/notifications": "notifications",
  "/admin": "warehouse",
  "/admin/users": "warehouse",
  "/admin/suppliers": "supplier",
  "/admin/audit": "qc",
  "/admin_/audit": "qc",
  "/admin_/users": "warehouse",
  "/admin_/suppliers": "supplier",
};
export const inventoryHelp: Record<string, HelpId> = {
  dashboard: "warehouse", putaway: "putaway", inventory: "inventory", requests: "requisitions",
  picking: "requisitions", locations: "locations",
};
