/**
 * Vehicle Plate Formatting & Barcode/QR Parsing Utility for KaizenX Mobile
 */

export function formatVehiclePlate(value: string): string {
  if (!value) return "";
  const compact = value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 11);

  const bharat = compact.match(/^(\d{2})BH(\d{4})([A-Z]{2})$/);
  if (bharat && bharat[1] && bharat[2] && bharat[3]) {
    return `${bharat[1]}-BH-${bharat[2]}-${bharat[3]}`;
  }

  const standard = compact.match(/^([A-Z]{2})(\d{1,2})([A-Z]{1,3})(\d{4})$/);
  if (standard && standard[1] && standard[2] && standard[3] && standard[4]) {
    return `${standard[1]}-${standard[2].padStart(2, "0")}-${standard[3]}-${standard[4]}`;
  }

  return compact;
}

export function parseScannedQrCode(scannedText: string): {
  type: "GATE_ENTRY" | "ASN" | "PO" | "VEHICLE" | "UNKNOWN";
  reference: string;
  poNumber?: string;
  asnNumber?: string;
  vehicleNumber?: string;
} {
  if (!scannedText) return { type: "UNKNOWN", reference: "" };
  const clean = scannedText.trim();

  // Check if JSON payload (Supplier Delivery QR / ASN QR)
  if (clean.startsWith("{") && clean.endsWith("}")) {
    try {
      const obj = JSON.parse(clean);
      const ref =
        obj.po_number ||
        obj.poNumber ||
        obj.asn_number ||
        obj.asnNumber ||
        obj.vehicle_number ||
        obj.reference ||
        clean;
      return {
        type: obj.asn_number ? "ASN" : obj.po_number ? "PO" : "UNKNOWN",
        reference: String(ref).toUpperCase().trim(),
        poNumber: obj.po_number || obj.poNumber,
        asnNumber: obj.asn_number || obj.asnNumber,
        vehicleNumber: obj.vehicle_number || obj.vehicleNumber,
      };
    } catch {
      // fallback
    }
  }

  const upper = clean.toUpperCase();

  if (upper.includes("KAIZENX:GATE_ENTRY:") || upper.includes("NEXUSWMS:GATE_ENTRY:")) {
    const parts = upper.split(":");
    return { type: "GATE_ENTRY", reference: parts[parts.length - 1] || upper };
  }

  if (upper.startsWith("ASN-") || upper.includes("ASN")) {
    return { type: "ASN", reference: upper };
  }

  if (upper.startsWith("PO-") || upper.includes("PO")) {
    return { type: "PO", reference: upper };
  }

  if (/^(?:[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}|\d{2}BH\d{4}[A-Z]{2})$/.test(upper.replace(/[^A-Z0-9]/g, ""))) {
    return { type: "VEHICLE", reference: formatVehiclePlate(upper) };
  }

  return { type: "UNKNOWN", reference: upper };
}
