export function parseNonNegativeNumber(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function parsePositiveNumber(value: unknown): number | null {
  const parsed = parseNonNegativeNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export function isValidDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Date inputs are calendar dates, so validate without a local-to-UTC shift.
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function localDateInput(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function completionDateError(value: string, today = localDateInput()): string | null {
  if (!value) return "Required completion date is required.";
  if (!isValidDateInput(value)) return "Enter a valid completion date.";
  if (value < today) return "Required completion date must be today or later.";
  return null;
}

export function pickupDateError(value: string, today = localDateInput()): string | null {
  if (!value) return "Expected pickup date is required.";
  if (!isValidDateInput(value)) return "Enter a valid expected pickup date.";
  if (value < today) return "Pickup date must be today or later.";
  return null;
}

export function requiredText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function sanitizeVehicleNumber(value: string): string {
  return value.replace(/[^A-Za-z0-9 ]/g, "");
}

export function isValidVehicleNumber(value: string): boolean {
  return /^[A-Za-z0-9 ]+$/.test(value.trim());
}

export function normalizeAsnVehicleNumber(value: string): string {
  return value.toUpperCase().replace(/[\s-]+/g, "");
}

export function isValidAsnVehicleNumber(value: string): boolean {
  const normalized = normalizeAsnVehicleNumber(value);
  return (
    /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(normalized) ||
    /^\d{2}BH\d{4}[A-Z]{2}$/.test(normalized)
  );
}

const INTEGER_QUANTITY_UOMS = new Set([
  "EA",
  "EACH",
  "UNIT",
  "UNITS",
  "PCS",
  "PC",
  "PIECE",
  "PIECES",
  "SET",
  "SETS",
  "BOX",
  "BOXES",
  "BAG",
  "BAGS",
  "PACK",
  "PACKS",
  "PAIR",
  "PAIRS",
  "DOZEN",
]);

export function isValidAsnQuantity(value: unknown, uom: string): boolean {
  const raw = typeof value === "string" ? value.trim() : String(value ?? "");
  const match = /^(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return false;

  const wholePart = match[1];
  if (wholePart === undefined) return false;
  const whole = wholePart.replace(/^0+(?=\d)/, "");
  const fraction = (match[2] || "").replace(/0+$/, "");
  if (whole.length > 14 || fraction.length > 4) return false;
  if (INTEGER_QUANTITY_UOMS.has(uom.trim().toUpperCase()) && /[1-9]/.test(fraction)) {
    return false;
  }

  return BigInt(`${whole}${fraction}`) > 0n;
}

export function isIntegerQuantityUom(uom: string): boolean {
  return INTEGER_QUANTITY_UOMS.has((uom || "").trim().toUpperCase());
}

export function sanitizeNumericQuantity(value: string, uom = ""): string {
  if (typeof value !== "string") value = String(value ?? "");
  const isInteger = isIntegerQuantityUom(uom);
  if (isInteger) {
    return value.replace(/[^0-9]/g, "");
  }
  let cleaned = value.replace(/[^0-9.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length > 2) {
    cleaned = parts[0] + "." + parts.slice(1).join("");
  }
  const [whole, decimal] = cleaned.split(".");
  if (decimal !== undefined) {
    return `${whole}.${decimal.slice(0, 4)}`;
  }
  return cleaned;
}

export function sanitizePersonName(value: string): string {
  return value.replace(/[^A-Za-z ]/g, "");
}

export function isValidPersonName(value: string): boolean {
  return /^[A-Za-z ]+$/.test(value.trim()) && value.trim().length >= 2;
}

export function sanitizeMobileNumber(value: string): string {
  return value.replace(/[^0-9]/g, "").slice(0, 10);
}

export function isValidMobileNumber(value: string): boolean {
  return /^\d{10}$/.test(value.trim());
}

export function isValidAsnDriverMobileNumber(value: string): boolean {
  return /^[6-9]\d{9}$/.test(value.trim());
}

export function sanitizeAsnDriverName(value: string): string {
  return value.replace(/[^A-Za-z .,'’-]/g, "");
}

export function isValidAsnDriverName(value: string): boolean {
  const name = value.trim();
  return (
    name.length >= 2 &&
    name.length <= 100 &&
    /^[A-Za-z .,'’-]+$/.test(name) &&
    (name.match(/[A-Za-z]/g)?.length ?? 0) >= 2
  );
}

export function isValidIdentifier(value: string, pattern = /^[A-Za-z0-9/_-]+$/): boolean {
  return pattern.test(value.trim());
}

export function isValidUpload(
  file: File,
  allowedTypes: readonly string[],
  maxBytes = 5 * 1024 * 1024,
): boolean {
  return allowedTypes.includes(file.type) && file.size > 0 && file.size <= maxBytes;
}

export function isValidInspectorName(value: string): boolean {
  const name = value.trim();
  return (
    name.length >= 2 &&
    name.length <= 128 &&
    /^[\p{L}\p{M} .'-]+$/u.test(name) &&
    (name.match(/\p{L}/gu)?.length ?? 0) >= 2
  );
}
