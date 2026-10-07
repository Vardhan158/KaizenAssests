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
} {
  if (!scannedText) return { type: "UNKNOWN", reference: "" };
  const clean = scannedText.trim().toUpperCase();

  if (clean.includes("KAIZENX:GATE_ENTRY:") || clean.includes("NEXUSWMS:GATE_ENTRY:")) {
    const parts = clean.split(":");
    return { type: "GATE_ENTRY", reference: parts[parts.length - 1] || clean };
  }

  if (clean.startsWith("ASN-") || clean.includes("ASN")) {
    return { type: "ASN", reference: clean };
  }

  if (clean.startsWith("PO-") || clean.includes("PO")) {
    return { type: "PO", reference: clean };
  }

  if (/^(?:[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}|\d{2}BH\d{4}[A-Z]{2})$/.test(clean.replace(/[^A-Z0-9]/g, ""))) {
    return { type: "VEHICLE", reference: formatVehiclePlate(clean) };
  }

  return { type: "UNKNOWN", reference: clean };
}
