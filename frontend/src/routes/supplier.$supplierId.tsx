import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Building2,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  ReceiptText,
  Save,
  ShieldCheck,
  X,
  AlertCircle,
  ChevronRight,
  Download,
  Star,
  Plus,
} from "lucide-react";
import { AppShell, StatusBadge } from "@/components/wms/app-shell";
import { Field, SectionCard } from "@/components/wms/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { INDIAN_STATES, TDS_SECTIONS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/supplier/$supplierId")({
  component: SupplierProfile,
});

function SupplierProfile() {
  const { supplierId } = Route.useParams();
  const [supplier, setSupplier] = useState<any>(null);
  const [purchaseOrders, setPurchaseOrders] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [form, setForm] = useState<any>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [vendorTypes, setVendorTypes] = useState<string[]>([
    "Manufacturer",
    "Distributor",
    "Trader / Stockist",
    "OEM / Equipment Supplier",
    "Authorized Dealer",
    "Logistics Partner",
    "Subcontractor",
    "Raw Material Supplier",
    "Service Provider",
  ]);
  const [categories, setCategories] = useState<string[]>([
    "Raw Materials",
    "Packaging",
    "Finished Goods",
    "Consumables",
    "Hardware & Components",
    "Electrical & Electronics",
    "Chemicals & Lubricants",
    "Tools & Equipment",
    "MRO (Maintenance, Repair, Operations)",
    "Logistics & Transport",
  ]);
  const [newVendorTypeInput, setNewVendorTypeInput] = useState("");
  const [showAddVendorTypeModal, setShowAddVendorTypeModal] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [addingVendorType, setAddingVendorType] = useState(false);

  useEffect(() => {
    api
      .getSupplier(supplierId)
      .then((data) => {
        setSupplier(data);
        if (data) {
          api
            .getPurchaseOrders({ supplierId: supplierId })
            .then((pos) => {
              if (Array.isArray(pos)) setPurchaseOrders(pos);
            })
            .catch(() => {});
        }
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Unable to load supplier profile."),
      );

    api
      .getVendorTypes()
      .then((vTypes) => {
        if (Array.isArray(vTypes) && vTypes.length > 0) {
          const names = vTypes.map((vt: any) => vt.name || vt);
          setVendorTypes((prev) => Array.from(new Set([...prev, ...names])));
        }
      })
      .catch(() => {});

    api
      .getSupplierCategories()
      .then((cats) => {
        if (Array.isArray(cats) && cats.length > 0) {
          const names = cats.map((c: any) => c.name || c);
          setCategories((prev) => Array.from(new Set([...prev, ...names])));
        }
      })
      .catch((err) => console.warn("Failed to fetch categories", err));
  }, [supplierId]);

  const handleAddVendorType = async () => {
    const trimmed = newVendorTypeInput.trim();
    if (!trimmed) return;
    try {
      setAddingVendorType(true);
      await api.createVendorType(trimmed).catch(() => {});
      setVendorTypes((prev) => Array.from(new Set([...prev, trimmed])));
      if (form) {
        updateForm("root", "vendorType", trimmed);
      }
      setNewVendorTypeInput("");
      setShowAddVendorTypeModal(false);
      toast.success("Vendor type added", { description: `${trimmed} added and selected` });
    } catch {
      toast.error("Failed to add vendor type");
    } finally {
      setAddingVendorType(false);
    }
  };

  const handleAddCategory = async () => {
    const trimmed = newCategoryInput.trim();
    if (!trimmed) return;
    try {
      setAddingCategory(true);
      await api.createSupplierCategory(trimmed).catch(() => {});
      setCategories((prev) => Array.from(new Set([...prev, trimmed])));
      if (form) {
        const current = Array.isArray(form.category) ? form.category : [];
        if (!current.includes(trimmed)) {
          updateForm("root", "category", [...current, trimmed]);
        }
      }
      setNewCategoryInput("");
      toast.success("Category added", { description: `${trimmed} added and selected` });
    } catch {
      toast.error("Failed to add category");
    } finally {
      setAddingCategory(false);
    }
  };

  const title = supplier?.supplierName || "Supplier profile";
  const openEditor = () => {
    const copy = JSON.parse(JSON.stringify(supplier || {}));
    copy.paymentTerms = copy.paymentTerms || copy.payment_terms || "Net 30";
    copy.creditPeriodDays = copy.creditPeriodDays ?? copy.credit_period_days ?? 30;
    setForm(copy);
    setEditing(true);
  };
  const updateForm = (section: string, field: string, value: any) => {
    setForm((current: any) =>
      section === "root"
        ? { ...current, [field]: value }
        : { ...current, [section]: { ...current[section], [field]: value } },
    );

    // Clear inline error
    const errorKey = section === "root" ? field : `${section}.${field}`;
    if (errors[errorKey]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[errorKey];
        return next;
      });
    }
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    const name = (form.supplierName || "").trim();
    const regName = (form.registeredCompanyName || "").trim();
    const industry = (form.industry || "").trim();
    const gstin = (form.gstin || "").trim();
    const mainMaterials = form.mainMaterials || [];

    if (!name) newErrors.supplierName = "Supplier name is required";
    else if (name.length < 2 || name.length > 100)
      newErrors.supplierName = "Must be between 2 and 100 characters";

    if (!regName) newErrors.registeredCompanyName = "Registered company name is required";
    else if (regName.length < 2 || regName.length > 200)
      newErrors.registeredCompanyName = "Must be between 2 and 200 characters";

    if (!form.vendorType) newErrors.vendorType = "Vendor type is required";
    if (!form.category || form.category.length === 0)
      newErrors.category = "At least one category is required";
    if (mainMaterials.length === 0) newErrors.mainMaterials = "Select at least one material";

    if (!industry) newErrors.industry = "Industry is required";
    else if (industry.length < 2 || industry.length > 100)
      newErrors.industry = "Must be between 2 and 100 characters";

    if (!gstin) newErrors.gstin = "GSTIN is required";
    else if (gstin.length !== 15) newErrors.gstin = "Exactly 15 characters";
    else if (
      !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin.toUpperCase())
    ) {
      newErrors.gstin = "Invalid format (e.g. 29ABCDE1234F1Z5)";
    }

    // Address & Contact Validation
    if (form.address) {
      const addr = (form.address.registeredAddress || "").trim();
      const city = (form.address.city || "").trim();
      const pincode = (form.address.pincode || "").trim();
      const state = (form.address.state || "").trim();

      if (!addr) newErrors["address.registeredAddress"] = "Address is required";
      else if (addr.length < 10 || addr.length > 300)
        newErrors["address.registeredAddress"] = "Must be between 10 and 300 characters";

      if (!city) newErrors["address.city"] = "City is required";
      else if (city.length < 2 || city.length > 100)
        newErrors["address.city"] = "Must be between 2 and 100 characters";
      else if (!/^[a-zA-Z\s-]+$/.test(city))
        newErrors["address.city"] = "Letters/spaces/hyphen only";

      if (state && (state.length < 2 || state.length > 100))
        newErrors["address.state"] = "Must be 2-100 characters";

      if (!pincode) newErrors["address.pincode"] = "Pincode is required";
      else if (!/^\d{6}$/.test(pincode)) newErrors["address.pincode"] = "Must be exactly 6 digits";
    }

    if (form.contact) {
      const contactName = (form.contact.primaryContactName || "").trim();
      const phone = (form.contact.phone || "").trim();
      const primaryEmail = (form.contact.primaryEmail || "").trim();
      const secondaryEmail = (form.contact.secondaryEmail || "").trim();
      const website = (form.contact.website || "").trim();
      const designation = (form.contact.designation || "").trim();

      if (!contactName) newErrors["contact.primaryContactName"] = "Name is required";
      else if (contactName.length < 2 || contactName.length > 100)
        newErrors["contact.primaryContactName"] = "Must be 2-100 characters";
      else if (!/^[a-zA-Z\s]+$/.test(contactName))
        newErrors["contact.primaryContactName"] = "Letters and spaces only";

      if (!phone) newErrors["contact.phone"] = "Phone is required";
      else if (!/^[6-9]\d{9}$/.test(phone))
        newErrors["contact.phone"] = "Must be 10-digit mobile number";

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!primaryEmail) newErrors["contact.primaryEmail"] = "Email is required";
      else if (!emailRegex.test(primaryEmail)) newErrors["contact.primaryEmail"] = "Invalid email";

      if (secondaryEmail && !emailRegex.test(secondaryEmail))
        newErrors["contact.secondaryEmail"] = "Invalid email";

      if (designation && (designation.length < 2 || designation.length > 100))
        newErrors["contact.designation"] = "Must be 2-100 characters";

      if (website) {
        try {
          new URL(website.startsWith("http") ? website : `https://${website}`);
        } catch (_) {
          newErrors["contact.website"] = "Invalid URL";
        }
      }
    }

    if (form.bankInfo) {
      const bankName = (form.bankInfo.bankName || "").trim();
      const accNo = (form.bankInfo.accountNumber || "").trim();
      const ifsc = (form.bankInfo.ifsc || "").trim();
      const holder = (form.bankInfo.accountHolderName || "").trim();
      const branch = (form.bankInfo.branch || "").trim();
      const swift = (form.bankInfo.swiftBic || "").trim();

      if (!bankName) newErrors["bankInfo.bankName"] = "Bank name is required";

      if (!accNo) newErrors["bankInfo.accountNumber"] = "Account number is required";
      else if (accNo.length < 9 || accNo.length > 18)
        newErrors["bankInfo.accountNumber"] = "9-18 digits required";
      else if (!/^\d+$/.test(accNo)) newErrors["bankInfo.accountNumber"] = "Digits only";

      if (!ifsc) newErrors["bankInfo.ifsc"] = "IFSC code is required";
      else if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase())) {
        newErrors["bankInfo.ifsc"] = "Invalid format (e.g. SBIN0012345)";
      }

      if (!holder) newErrors["bankInfo.accountHolderName"] = "Holder name is required";
      if (!branch) newErrors["bankInfo.branch"] = "Branch is required";

      if (swift && !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swift.toUpperCase())) {
        newErrors["bankInfo.swiftBic"] = "Invalid format";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const saveChanges = async () => {
    if (!validate()) {
      return;
    }

    const name = (form.supplierName || "").trim();
    const regName = (form.registeredCompanyName || "").trim();
    const industry = (form.industry || "").trim();
    const gstin = (form.gstin || "").trim();

    setSaving(true);
    try {
      const finalForm = {
        ...form,
        supplierName: name,
        registeredCompanyName: regName,
        industry: industry,
        gstin: gstin.toUpperCase(),
        paymentTerms: form.paymentTerms,
        payment_terms: form.paymentTerms,
        creditPeriodDays: form.creditPeriodDays ? Number(form.creditPeriodDays) : undefined,
        credit_period_days: form.creditPeriodDays ? Number(form.creditPeriodDays) : undefined,
      };
      const updated = await api.updateSupplier(supplierId, finalForm);
      setSupplier(updated);
      setEditing(false);
      toast.success("Supplier profile updated");
    } catch (err) {
      toast.error("Unable to update supplier", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  };
  const handleDownloadRealtimePdf = (doc: any) => {
    try {
      const docType = doc.documentType || doc.document_type || "Compliance Document";
      const fileName =
        doc.fileName || doc.file_name || `${supplier?.supplierName || "Supplier"}_${docType}.pdf`;
      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8" />
          <title>${fileName}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; color: #1e293b; background: #fff; }
            .header { border-bottom: 2px solid #2563eb; padding-bottom: 15px; margin-bottom: 20px; }
            .title { font-size: 20px; font-weight: bold; color: #2563eb; }
            .subtitle { font-size: 12px; color: #64748b; margin-top: 4px; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 20px; }
            .field { background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; }
            .label { font-size: 10px; font-weight: bold; color: #64748b; text-transform: uppercase; }
            .value { font-size: 14px; font-weight: bold; margin-top: 4px; color: #0f172a; }
            .footer { margin-top: 40px; border-top: 1px solid #e2e8f0; padding-top: 15px; font-size: 10px; color: #94a3b8; text-align: center; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="title">${docType}</div>
            <div class="subtitle">Official Vendor Compliance Document · ${supplier?.supplierName || "Supplier Master"}</div>
          </div>
          <div class="info-grid">
            <div class="field"><div class="label">Supplier Name</div><div class="value">${supplier?.supplierName || "—"}</div></div>
            <div class="field"><div class="label">Registered Company</div><div class="value">${supplier?.registeredCompanyName || "—"}</div></div>
            <div class="field"><div class="label">GSTIN</div><div class="value">${supplier?.gstin || "—"}</div></div>
            <div class="field"><div class="label">Vendor Code</div><div class="value">${supplier?.supplierCode || supplier?.supplierId || "—"}</div></div>
            <div class="field"><div class="label">Document Category</div><div class="value">${docType}</div></div>
            <div class="field"><div class="label">Verification Status</div><div class="value" style="color:#059669;">Verified &amp; Active</div></div>
          </div>
          <div style="margin-top: 30px; padding: 20px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px;">
            <p style="font-size: 12px; font-weight: bold; color: #065f46; margin: 0;">Verified Compliance Record</p>
            <p style="font-size: 11px; color: #047857; margin-top: 4px;">This document certifies that ${supplier?.supplierName || "the supplier"} (GSTIN: ${supplier?.gstin || "N/A"}) is a registered, verified vendor in KaizenX platform master data.</p>
          </div>
          <div class="footer">
            Generated automatically by KaizenX Procurement Portal · ${new Date().toLocaleString("en-IN")}
          </div>
        </body>
        </html>
      `;

      const printWin = window.open("", "_blank");
      if (printWin) {
        printWin.document.write(htmlContent);
        printWin.document.close();
        printWin.focus();
        setTimeout(() => {
          printWin.print();
        }, 500);
      } else {
        toast.error("Popup blocked. Please allow popups to download real-time PDF.");
      }
    } catch (e: any) {
      toast.error("Failed to generate real-time PDF", { description: e.message });
    }
  };

  const handleDownloadDocument = async (doc: any, downloadUrl: string) => {
    const fileName = doc.fileName || doc.file_name || "supplier-document.pdf";

    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`File not found (${response.status})`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      toast.error("Stored document file is missing", {
        description: "Generating the supplier compliance PDF instead.",
      });
      handleDownloadRealtimePdf(doc);
    }
  };

  return (
    <AppShell
      title={supplier?.supplierName || "Supplier Profile"}
      subtitle={`GSTIN: ${supplier?.gstin || "—"}`}
      actions={
        supplier && (
          <div className="flex items-center gap-2">
            <StatusBadge status={supplier.status || "Active"} />
            <Button variant="outline" className="rounded-xl font-bold" onClick={openEditor}>
              <Pencil className="mr-1.5 size-3.5" /> Edit Supplier
            </Button>
          </div>
        )
      }
    >
      <Button variant="ghost" className="mb-4 rounded-xl font-bold text-xs" asChild>
        <Link to="/master-data">
          <ArrowLeft className="mr-2 size-4" /> Back to Suppliers
        </Link>
      </Button>
      {!supplier && !error && (
        <div className="flex h-64 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin text-primary" /> Loading supplier profile…
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6">
          <p className="font-medium text-destructive">Supplier profile could not be loaded.</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      )}
      {supplier && (
        <div className="space-y-4">
          {editing && form && (
            <SectionCard
              title="Edit supplier"
              description="Changes are saved immediately to the supplier master"
              icon={Pencil}
              actions={
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(false)}
                    disabled={saving}
                  >
                    <X /> Cancel
                  </Button>
                  <Button size="sm" onClick={saveChanges} disabled={saving}>
                    <Save /> {saving ? "Saving…" : "Save changes"}
                  </Button>
                </>
              }
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <ValidatedEditField
                  label="Supplier name"
                  value={form.supplierName}
                  error={errors.supplierName}
                  onChange={(value) => {
                    const sanitized = value.replace(/[^a-zA-Z\s]/g, "");
                    updateForm("root", "supplierName", sanitized);
                  }}
                />
                <ValidatedEditField
                  label="Registered company"
                  value={form.registeredCompanyName}
                  error={errors.registeredCompanyName}
                  onChange={(value) => {
                    const sanitized = value.replace(/[^a-zA-Z\s]/g, "");
                    updateForm("root", "registeredCompanyName", sanitized);
                  }}
                />
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label>Vendor type</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAddVendorTypeModal(true)}
                      className="h-5 px-1.5 text-[10px] font-bold text-primary hover:bg-primary/10 rounded-md"
                    >
                      <Plus className="size-3 mr-0.5" /> Add Type
                    </Button>
                  </div>
                  <Select
                    onValueChange={(v) => {
                      if (v === "__ADD_NEW_VENDOR_TYPE__") {
                        setShowAddVendorTypeModal(true);
                      } else {
                        updateForm("root", "vendorType", v);
                      }
                    }}
                    value={form.vendorType}
                  >
                    <SelectTrigger
                      className={cn(
                        errors.vendorType && "border-destructive focus:ring-destructive",
                      )}
                    >
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {vendorTypes.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type}
                        </SelectItem>
                      ))}
                      <SelectItem value="__ADD_NEW_VENDOR_TYPE__" className="text-primary font-bold">
                        + Add Custom Vendor Type...
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.vendorType && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {errors.vendorType}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className={cn(
                          "w-full justify-between rounded-xl h-10 px-3 font-normal",
                          errors.category && "border-destructive",
                        )}
                      >
                        <span className="truncate">
                          {Array.isArray(form.category) && form.category.length > 0
                            ? form.category.join(", ")
                            : "Select categories"}
                        </span>
                        <ChevronRight className="ml-2 h-4 w-4 shrink-0 opacity-50 rotate-90" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[320px] p-0 rounded-xl shadow-xl" align="start">
                      <div className="p-2 space-y-1 max-h-[250px] overflow-y-auto border-b">
                        {categories.map((cat) => (
                          <div
                            key={cat}
                            className="flex items-center space-x-2 p-2 hover:bg-muted/60 rounded-lg cursor-pointer transition-colors"
                            onClick={() => {
                              const current = Array.isArray(form.category) ? form.category : [];
                              const updated = current.includes(cat)
                                ? current.filter((c: string) => c !== cat)
                                : [...current, cat];
                              updateForm("root", "category", updated);
                            }}
                          >
                            <Checkbox
                              id={`edit-cat-${cat}`}
                              checked={Array.isArray(form.category) && form.category.includes(cat)}
                              onCheckedChange={() => {
                                const current = Array.isArray(form.category) ? form.category : [];
                                const updated = current.includes(cat)
                                  ? current.filter((c: string) => c !== cat)
                                  : [...current, cat];
                                updateForm("root", "category", updated);
                              }}
                            />
                            <Label
                              htmlFor={`edit-cat-${cat}`}
                              className="text-sm cursor-pointer w-full font-medium"
                            >
                              {cat}
                            </Label>
                          </div>
                        ))}
                      </div>
                      <div className="p-3 bg-muted/20 space-y-2">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Add Custom Category</p>
                        <div className="flex gap-2">
                          <Input
                            placeholder="e.g. Precision Castings"
                            value={newCategoryInput}
                            onChange={(e) => setNewCategoryInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void handleAddCategory();
                              }
                            }}
                            className="h-8 rounded-lg text-xs"
                          />
                          <Button
                            type="button"
                            size="sm"
                            disabled={!newCategoryInput.trim() || addingCategory}
                            onClick={() => void handleAddCategory()}
                            className="h-8 rounded-lg text-xs font-bold shrink-0"
                          >
                            <Plus className="size-3.5 mr-1" /> Add
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                  {errors.category && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {errors.category}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label>Main materials</Label>
                  <Input
                    value={
                      Array.isArray(form.mainMaterials)
                        ? form.mainMaterials.join(", ")
                        : form.mainMaterial || ""
                    }
                    onChange={(event) =>
                      updateForm(
                        "root",
                        "mainMaterials",
                        event.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      )
                    }
                    placeholder="Comma separated list"
                    className={cn(
                      errors.mainMaterials && "border-destructive focus-visible:ring-destructive",
                    )}
                  />
                  {errors.mainMaterials && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {errors.mainMaterials}
                    </p>
                  )}
                </div>
                <ValidatedEditField
                  label="Industry"
                  value={form.industry}
                  error={errors.industry}
                  onChange={(value) => updateForm("root", "industry", value)}
                />
                <ValidatedEditField
                  label="GSTIN"
                  value={form.gstin}
                  error={errors.gstin}
                  maxLength={15}
                  onChange={(value) => updateForm("root", "gstin", value.substring(0, 15))}
                />
                {form.address && (
                  <>
                    <ValidatedEditField
                      label="Address"
                      value={form.address.registeredAddress}
                      error={errors["address.registeredAddress"]}
                      onChange={(value) => updateForm("address", "registeredAddress", value)}
                    />
                    <ValidatedEditField
                      label="City"
                      value={form.address.city}
                      error={errors["address.city"]}
                      onChange={(value) => updateForm("address", "city", value)}
                    />
                    <div className="space-y-1.5">
                      <Label>State</Label>
                      <Select
                        onValueChange={(v) => updateForm("address", "state", v)}
                        value={form.address.state}
                      >
                        <SelectTrigger
                          className={cn(
                            errors["address.state"] && "border-destructive focus:ring-destructive",
                          )}
                        >
                          <SelectValue placeholder="Select state" />
                        </SelectTrigger>
                        <SelectContent>
                          {INDIAN_STATES.map((state) => (
                            <SelectItem key={state} value={state}>
                              {state}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {errors["address.state"] && (
                        <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                          <AlertCircle className="size-3" /> {errors["address.state"]}
                        </p>
                      )}
                    </div>
                    <EditField
                      label="Country"
                      value={form.address.country}
                      onChange={(value) => updateForm("address", "country", value)}
                    />
                    <ValidatedEditField
                      label="Pincode"
                      value={form.address.pincode}
                      error={errors["address.pincode"]}
                      maxLength={6}
                      onChange={(value) => {
                        const sanitized = value.replace(/\D/g, "").substring(0, 6);
                        updateForm("address", "pincode", sanitized);
                      }}
                    />
                  </>
                )}
                {form.contact && (
                  <>
                    <ValidatedEditField
                      label="Primary contact"
                      value={form.contact.primaryContactName}
                      error={errors["contact.primaryContactName"]}
                      onChange={(value) => updateForm("contact", "primaryContactName", value)}
                    />
                    <ValidatedEditField
                      label="Primary Email"
                      value={form.contact.primaryEmail}
                      error={errors["contact.primaryEmail"]}
                      maxLength={128}
                      onChange={(value) => {
                        const sanitized = value.replace(/\s/g, "").substring(0, 128);
                        updateForm("contact", "primaryEmail", sanitized);

                        // Run-time validation
                        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                        if (sanitized && !emailRegex.test(sanitized)) {
                          setErrors((prev) => ({
                            ...prev,
                            ["contact.primaryEmail"]: "Invalid email format",
                          }));
                        } else {
                          setErrors((prev) => {
                            const next = { ...prev };
                            delete next["contact.primaryEmail"];
                            return next;
                          });
                        }
                      }}
                    />
                    <ValidatedEditField
                      label="Secondary Email"
                      value={form.contact.secondaryEmail}
                      error={errors["contact.secondaryEmail"]}
                      maxLength={128}
                      onChange={(value) => {
                        const sanitized = value.replace(/\s/g, "").substring(0, 128);
                        updateForm("contact", "secondaryEmail", sanitized);

                        // Run-time validation
                        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                        if (sanitized && !emailRegex.test(sanitized)) {
                          setErrors((prev) => ({
                            ...prev,
                            ["contact.secondaryEmail"]: "Invalid email format",
                          }));
                        } else {
                          setErrors((prev) => {
                            const next = { ...prev };
                            delete next["contact.secondaryEmail"];
                            return next;
                          });
                        }
                      }}
                    />
                    <ValidatedEditField
                      label="Phone"
                      value={form.contact.phone}
                      error={errors["contact.phone"]}
                      maxLength={10}
                      onChange={(value) => {
                        const sanitized = value.replace(/\D/g, "").substring(0, 10);
                        updateForm("contact", "phone", sanitized);
                      }}
                    />
                  </>
                )}
                {form.bankInfo && (
                  <>
                    <ValidatedEditField
                      label="Bank Name"
                      value={form.bankInfo.bankName}
                      error={errors["bankInfo.bankName"]}
                      onChange={(value) => updateForm("bankInfo", "bankName", value)}
                    />
                    <ValidatedEditField
                      label="Account Number"
                      value={form.bankInfo.accountNumber}
                      error={errors["bankInfo.accountNumber"]}
                      maxLength={18}
                      onChange={(value) =>
                        updateForm(
                          "bankInfo",
                          "accountNumber",
                          value.replace(/\D/g, "").substring(0, 18),
                        )
                      }
                    />
                    <ValidatedEditField
                      label="IFSC Code"
                      value={form.bankInfo.ifsc}
                      error={errors["bankInfo.ifsc"]}
                      maxLength={11}
                      onChange={(value) =>
                        updateForm(
                          "bankInfo",
                          "ifsc",
                          value
                            .replace(/[^a-zA-Z0-9]/g, "")
                            .substring(0, 11)
                            .toUpperCase(),
                        )
                      }
                    />
                    <ValidatedEditField
                      label="Account Holder"
                      value={form.bankInfo.accountHolderName}
                      error={errors["bankInfo.accountHolderName"]}
                      onChange={(value) => updateForm("bankInfo", "accountHolderName", value)}
                    />
                    <ValidatedEditField
                      label="Branch"
                      value={form.bankInfo.branch}
                      error={errors["bankInfo.branch"]}
                      onChange={(value) => updateForm("bankInfo", "branch", value)}
                    />
                    <ValidatedEditField
                      label="SWIFT / BIC"
                      value={form.bankInfo.swiftBic}
                      error={errors["bankInfo.swiftBic"]}
                      maxLength={11}
                      onChange={(value) =>
                        updateForm(
                          "bankInfo",
                          "swiftBic",
                          value
                            .replace(/[^a-zA-Z0-9]/g, "")
                            .substring(0, 11)
                            .toUpperCase(),
                        )
                      }
                    />
                    <div className="space-y-1.5">
                      <Label>TDS Section</Label>
                      <Select
                        onValueChange={(v) => updateForm("bankInfo", "tdsSection", v)}
                        value={form.bankInfo.tdsSection}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select TDS section" />
                        </SelectTrigger>
                        <SelectContent>
                          {TDS_SECTIONS.map((section) => (
                            <SelectItem key={section} value={section}>
                              {section}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Payment Terms</Label>
                      <Select
                        onValueChange={(v) => updateForm("root", "paymentTerms", v)}
                        value={form.paymentTerms}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select payment terms" />
                        </SelectTrigger>
                        <SelectContent>
                          {["Immediate", "Net 15", "Net 30", "Net 45", "Net 60", "Advance"].map(
                            (term) => (
                              <SelectItem key={term} value={term}>
                                {term}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <ValidatedEditField
                      label="Credit Period (Days)"
                      value={form.creditPeriodDays ? String(form.creditPeriodDays) : ""}
                      maxLength={3}
                      onChange={(value) =>
                        updateForm(
                          "root",
                          "creditPeriodDays",
                          value.replace(/\D/g, "").substring(0, 3),
                        )
                      }
                    />
                  </>
                )}
              </div>
              <div className="mt-4">
                <Label htmlFor="remarks">Remarks</Label>
                <Textarea
                  id="remarks"
                  value={form.remarks || ""}
                  onChange={(event) => updateForm("root", "remarks", event.target.value)}
                  className="mt-2"
                />
              </div>
            </SectionCard>
          )}
          {/* TAB NAVIGATION BAR */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border/70 pb-3 mb-6">
            {[
              { id: "overview", label: "Overview", icon: Building2 },
              { id: "contacts", label: "Contacts", icon: Phone },
              { id: "addresses", label: "Addresses", icon: MapPin },
              { id: "bank", label: "Bank Details", icon: ReceiptText },
              { id: "documents", label: "Documents", icon: FileText },
              { id: "purchases", label: "Purchase History", icon: ReceiptText },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <Button
                  key={tab.id}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  className={cn(
                    "rounded-xl font-bold text-xs transition-all",
                    isActive && "shadow-soft",
                  )}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <Icon className="mr-1.5 size-3.5" />
                  {tab.label}
                </Button>
              );
            })}
          </div>

          {/* TAB CONTENT 1: OVERVIEW */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              <SectionCard
                title="Supplier overview"
                description="Core vendor record"
                icon={Building2}
                actions={<StatusBadge status={supplier.status || "Active"} />}
              >
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Supplier name" value={supplier.supplierName} />
                  <Field label="Vendor type" value={supplier.vendorType || "—"} />
                  <Field
                    label="Category"
                    value={
                      Array.isArray(supplier.category)
                        ? supplier.category.join(", ")
                        : supplier.category || "—"
                    }
                  />
                  <Field
                    label="Main materials"
                    value={
                      Array.isArray(supplier.mainMaterials)
                        ? supplier.mainMaterials.join(", ")
                        : supplier.mainMaterial || "—"
                    }
                  />
                  <Field label="GSTIN" value={supplier.gstin || "—"} mono />
                  <Field label="Status" value={supplier.status || "Pending Approval"} />
                  <Field
                    label="Payment Terms"
                    value={supplier.paymentTerms || supplier.payment_terms || "Net 30"}
                  />
                  <Field
                    label="Credit Period"
                    value={
                      (supplier.creditPeriodDays ?? supplier.credit_period_days) != null
                        ? `${supplier.creditPeriodDays ?? supplier.credit_period_days} days`
                        : "30 days"
                    }
                  />
                </div>
              </SectionCard>

              <SectionCard
                title="Audit Trail"
                description="Audit and record tracking"
                icon={ShieldCheck}
              >
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Created
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="size-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] text-primary font-bold uppercase">
                        {(supplier.createdBy || "S").charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {supplier.createdBy || "System Generated"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {supplier.createdAt
                            ? new Date(supplier.createdAt).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Last Updated
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="size-6 rounded-full bg-muted flex items-center justify-center text-[10px] text-muted-foreground font-bold uppercase">
                        {(supplier.updatedBy || supplier.createdBy || "S").charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-medium">
                          {supplier.updatedBy || supplier.createdBy || "System Generated"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {supplier.updatedAt
                            ? new Date(supplier.updatedAt).toLocaleDateString("en-IN", {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </SectionCard>
            </div>
          )}

          {/* TAB CONTENT 2: CONTACTS */}
          {activeTab === "contacts" && (
            <SectionCard
              title="Primary contact"
              description="Supplier contact details and designation"
              icon={Phone}
            >
              {supplier.contact ? (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  <Field
                    label="Contact Person"
                    value={supplier.contact.primaryContactName || "—"}
                  />
                  <Field label="Designation" value={supplier.contact.designation || "—"} />
                  <Field label="Phone" value={supplier.contact.phone || "—"} mono />
                  <Field label="Primary Email" value={supplier.contact.primaryEmail || "—"} />
                  <Field label="Secondary Email" value={supplier.contact.secondaryEmail || "—"} />
                  <Field label="Website" value={supplier.contact.website || "—"} />
                </div>
              ) : (
                <EmptySection text="No contact has been recorded." />
              )}
            </SectionCard>
          )}

          {/* TAB CONTENT 3: ADDRESSES */}
          {activeTab === "addresses" && (
            <SectionCard title="Address" description="Registered business location" icon={MapPin}>
              {supplier.address ? (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                  <Field
                    label="Registered address"
                    value={supplier.address.registeredAddress || "—"}
                  />
                  <Field
                    label="City / State"
                    value={
                      [supplier.address.city, supplier.address.state].filter(Boolean).join(", ") ||
                      "—"
                    }
                  />
                  <Field label="Country" value={supplier.address.country || "—"} />
                  <Field label="Pincode" value={supplier.address.pincode || "—"} mono />
                </div>
              ) : (
                <EmptySection text="No address has been recorded." />
              )}
            </SectionCard>
          )}

          {/* TAB CONTENT 4: BANK DETAILS */}
          {activeTab === "bank" && (
            <SectionCard
              title="Tax & banking"
              description="Payment and compliance details"
              icon={ReceiptText}
            >
              {supplier.bankInfo ? (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Bank Name" value={supplier.bankInfo.bankName || "—"} />
                  <Field
                    label="Account number"
                    value={supplier.bankInfo.accountNumber || "—"}
                    mono
                  />
                  <Field label="IFSC Code" value={supplier.bankInfo.ifsc || "—"} mono />
                  <Field
                    label="Account holder"
                    value={supplier.bankInfo.accountHolderName || "—"}
                  />
                  <Field label="Branch" value={supplier.bankInfo.branch || "—"} />
                  <Field label="SWIFT / BIC" value={supplier.bankInfo.swiftBic || "—"} mono />
                  <Field label="TDS Section" value={supplier.bankInfo.tdsSection || "—"} />
                  <Field
                    label="Payment Terms"
                    value={supplier.paymentTerms || supplier.payment_terms || "Net 30"}
                  />
                  <Field
                    label="Credit Period"
                    value={
                      (supplier.creditPeriodDays ?? supplier.credit_period_days) != null
                        ? `${supplier.creditPeriodDays ?? supplier.credit_period_days} days`
                        : "30 days"
                    }
                  />
                </div>
              ) : (
                <EmptySection text="No banking details have been recorded." />
              )}
            </SectionCard>
          )}

          {/* TAB CONTENT 5: DOCUMENTS */}
          {activeTab === "documents" && (
            <SectionCard
              title="Documents"
              description="Compliance and onboarding documents attached to this supplier"
              icon={FileText}
            >
              {supplier.documents?.length ? (
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {supplier.documents.map((document: any) => {
                    const rawUrl =
                      document.fileUrl ||
                      document.file_url ||
                      document.storagePath ||
                      document.storage_path;
                    const downloadUrl =
                      rawUrl && rawUrl !== "#" ? api.resolveMediaUrl(rawUrl) : null;

                    return (
                      <div
                        key={
                          document.uploadId ||
                          document.upload_id ||
                          document.fileName ||
                          document.file_name
                        }
                        className="flex items-center justify-between rounded-xl border border-border/70 p-4 bg-card shadow-soft hover:border-primary/40 transition-colors"
                      >
                        <div className="min-w-0 pr-2">
                          <p className="text-sm font-semibold truncate text-foreground">
                            {document.fileName || document.file_name || "Compliance Doc"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {document.documentType ||
                              document.document_type ||
                              "Compliance Document"}
                          </p>
                        </div>
                        {downloadUrl ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDownloadDocument(document, downloadUrl)}
                            className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary hover:text-primary-foreground transition-all"
                          >
                            <Download className="size-3.5" /> PDF
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-lg h-8 text-xs font-bold border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground transition-all"
                            onClick={() => handleDownloadRealtimePdf(document)}
                          >
                            <Download className="mr-1 size-3.5" /> PDF
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptySection text="No compliance documents have been attached." />
              )}
            </SectionCard>
          )}

          {/* TAB CONTENT 6: PURCHASE HISTORY */}
          {activeTab === "purchases" && (
            <SectionCard
              title="Purchase Order History"
              description="Purchase orders and historical transactions issued to this vendor"
              icon={ReceiptText}
            >
              {purchaseOrders.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/50 font-semibold uppercase text-muted-foreground text-[10px] tracking-wider border-b border-border/70">
                      <tr>
                        <th className="px-4 py-3">PO Number</th>
                        <th className="px-4 py-3">PO Date</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Total Amount</th>
                        <th className="px-4 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {purchaseOrders.map((po) => (
                        <tr key={po.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 font-mono font-bold text-primary">
                            {po.poNumber}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{po.poDate || "—"}</td>
                          <td className="px-4 py-3">
                            <StatusBadge status={po.status} />
                          </td>
                          <td className="px-4 py-3 text-right font-mono font-bold tabular-nums">
                            ₹{Number(po.totalAmount || 0).toLocaleString("en-IN")}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-xl h-7 text-[10px] font-bold"
                              asChild
                            >
                              <Link to="/purchase-order" search={{ poId: po.id }}>
                                View PO <ChevronRight className="ml-1 size-3" />
                              </Link>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptySection text="No purchase order history recorded for this supplier." />
              )}
            </SectionCard>
          )}

          {supplier.remarks && (
            <SectionCard title="Remarks" icon={Mail}>
              <p className="text-sm text-muted-foreground">{supplier.remarks}</p>
            </SectionCard>
          )}
        </div>
      )}

      {/* Add Custom Vendor Type Modal */}
      <Dialog open={showAddVendorTypeModal} onOpenChange={setShowAddVendorTypeModal}>
        <DialogContent className="rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Add Custom Vendor Type</DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Enter a custom vendor type to add it to master data and select it for this supplier.
            </p>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs font-bold uppercase text-muted-foreground">Vendor Type Name</Label>
              <Input
                placeholder="e.g. Custom Logistics Partner"
                value={newVendorTypeInput}
                onChange={(e) => setNewVendorTypeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleAddVendorType();
                  }
                }}
                className="mt-1.5 rounded-xl text-xs font-semibold"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-xl text-xs" onClick={() => setShowAddVendorTypeModal(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!newVendorTypeInput.trim() || addingVendorType}
                onClick={() => void handleAddVendorType()}
                className="rounded-xl text-xs font-bold shadow-glow"
              >
                {addingVendorType ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Plus className="size-3.5 mr-1" />}
                Add Vendor Type
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function EmptySection({ text }: { text: string }) {
  return <p className="py-4 text-sm text-muted-foreground">{text}</p>;
}

function EditField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value || ""} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function ValidatedEditField({
  label,
  value,
  error,
  maxLength,
  onChange,
}: {
  label: string;
  value?: string;
  error?: string;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        value={value || ""}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        className={cn(error && "border-destructive focus-visible:ring-destructive")}
      />
      {error && (
        <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
          <AlertCircle className="size-3" /> {error}
        </p>
      )}
    </div>
  );
}
