import * as React from "react";
import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Building2,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  FileText,
  CreditCard,
  Loader2,
  Plus,
  Upload,
  MessageSquare,
  FileIcon,
  X,
  AlertCircle,
  Info,
} from "lucide-react";
import { toast } from "sonner";

import { AppShell } from "@/components/wms/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";
import { INDIAN_STATES, TDS_SECTIONS } from "@/lib/constants";

export const Route = createFileRoute("/new-supplier")({
  component: NewSupplier,
});

const steps = [
  { id: 1, name: "Company Profile", icon: Building2 },
  { id: 2, name: "Address & Contact", icon: FileText },
  { id: 3, name: "Banking Information", icon: CreditCard },
  { id: 4, name: "Documents", icon: Upload },
  { id: 5, name: "Remarks", icon: MessageSquare },
];

function NewSupplier() {
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const currentModule = new URLSearchParams(location.searchStr || "").get("module");
  const [currentStep, setCurrentStep] = React.useState(1);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isLookingUpIfsc, setIsLookingUpIfsc] = React.useState(false);
  const [isLookingUpPincode, setIsLookingUpPincode] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // Vendor Types state
  const [vendorTypes, setVendorTypes] = React.useState([
    "Manufacturer",
    "Distributor",
    "Service Provider",
  ]);
  const [categories, setCategories] = React.useState([
    "Raw Materials",
    "Packaging",
    "Finished Goods",
    "Consumables",
  ]);
  const [rawMaterials, setRawMaterials] = React.useState([
    "Steel",
    "Aluminum",
    "Plastic",
    "Copper",
  ]);
  const [showAddVendorType, setShowAddVendorType] = React.useState(false);
  const [showAddCategory, setShowAddCategory] = React.useState(false);
  const [showAddRawMaterial, setShowAddRawMaterial] = React.useState(false);
  const [newVendorType, setNewVendorType] = React.useState("");
  const [newCategory, setNewCategory] = React.useState("");
  const [newRawMaterial, setNewRawMaterial] = React.useState("");

  React.useEffect(() => {
    const fetchMasterData = async () => {
      try {
        const [vTypes, cats, materials] = await Promise.all([
          api.getVendorTypes(),
          api.getSupplierCategories(),
          api.getRawMaterials(),
        ]);
        if (vTypes.length > 0) setVendorTypes(vTypes.map((t: any) => t.name));
        if (cats.length > 0) setCategories(cats.map((c: any) => c.name));
        if (materials.length > 0) setRawMaterials(materials.map((m: any) => m.name));
      } catch (e) {
        console.warn("Failed to fetch master data, using defaults", e);
      }
    };
    fetchMasterData();
  }, []);

  // Form State
  const [formData, setFormData] = React.useState({
    supplierName: "",
    registeredCompanyName: "",
    vendorType: "",
    category: [] as string[],
    mainMaterials: [] as string[],
    industry: "",
    gstin: "",
    paymentTerms: "",
    creditPeriodDays: "",
    modeOfPayment: "",
    address: {
      registeredAddress: "",
      city: "",
      country: "India",
      state: "",
      pincode: "",
    },
    contact: {
      primaryContactName: "",
      primaryEmail: "",
      secondaryEmail: "",
      designation: "",
      phone: "",
      website: "",
    },
    bankInfo: {
      bankName: "",
      accountNumber: "",
      accountHolderName: "",
      ifsc: "",
      branch: "",
      swiftBic: "",
      tdsSection: "",
    },
    documents: [] as any[],
    remarks: "",
  });

  const [isUploading, setIsUploading] = React.useState(false);

  const updateFormData = (section: string, field: string, value: string) => {
    if (section === "root") {
      setFormData((prev) => ({ ...prev, [field]: value }));
      // Clear error when user types
      if (errors[field]) {
        setErrors((prev) => {
          const newErrors = { ...prev };
          delete newErrors[field];
          return newErrors;
        });
      }
    } else {
      setFormData((prev: any) => ({
        ...prev,
        [section]: {
          ...prev[section],
          [field]: value,
        },
      }));
      const errorKey = `${section}.${field}`;
      if (errors[errorKey]) {
        setErrors((prev) => {
          const newErrors = { ...prev };
          delete newErrors[errorKey];
          return newErrors;
        });
      }
    }
  };

  const lookupIfsc = async (ifsc: string) => {
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return;
    setIsLookingUpIfsc(true);
    try {
      const details = await api.getBankDetailsByIfsc(ifsc);
      setFormData((previous) => ({
        ...previous,
        bankInfo: {
          ...previous.bankInfo,
          ifsc: details.ifsc,
          bankName: details.bank_name,
          branch: details.branch_name,
        },
      }));
      setErrors((previous) => {
        const next = { ...previous };
        delete next["bankInfo.ifsc"];
        delete next["bankInfo.bankName"];
        delete next["bankInfo.branch"];
        return next;
      });
    } catch (error) {
      setErrors((previous) => ({
        ...previous,
        "bankInfo.ifsc": error instanceof Error ? error.message : "Unable to find IFSC code",
      }));
    } finally {
      setIsLookingUpIfsc(false);
    }
  };

  const lookupPincode = React.useCallback(async (pincode: string) => {
    if (!/^\d{6}$/.test(pincode)) return;

    setIsLookingUpPincode(true);
    try {
      const response = await fetch(`https://api.postalpincode.in/pincode/${pincode}`);
      if (!response.ok) {
        throw new Error("Unable to lookup pincode");
      }

      const data = await response.json();
      const result = Array.isArray(data) ? data[0] : null;
      const postOffice = Array.isArray(result?.PostOffice) ? result.PostOffice[0] : null;

      if (result?.Status !== "Success" || !postOffice) {
        throw new Error("Invalid pincode");
      }

      const city = postOffice.District || postOffice.Block || postOffice.Name || "";
      const state = postOffice.State || "";

      setFormData((previous) => ({
        ...previous,
        address: {
          ...previous.address,
          city,
          state: INDIAN_STATES.includes(state) ? state : previous.address.state,
          pincode,
        },
      }));
      setErrors((previous) => {
        const next = { ...previous };
        delete next["address.city"];
        delete next["address.state"];
        delete next["address.pincode"];
        return next;
      });
    } catch (error) {
      setErrors((previous) => ({
        ...previous,
        "address.pincode": error instanceof Error ? error.message : "Unable to lookup pincode",
      }));
    } finally {
      setIsLookingUpPincode(false);
    }
  }, []);

  React.useEffect(() => {
    const pincode = formData.address.pincode;
    if (!/^\d{6}$/.test(pincode)) return;

    const timer = window.setTimeout(() => {
      void lookupPincode(pincode);
    }, 350);

    return () => window.clearTimeout(timer);
  }, [formData.address.pincode, lookupPincode]);

  const validateStep = async (step: number) => {
    const newErrors: Record<string, string> = {};

    if (step === 1) {
      const name = formData.supplierName.trim();
      const regName = formData.registeredCompanyName.trim();
      const industry = formData.industry.trim();
      const gstin = formData.gstin.trim();

      if (!name) newErrors.supplierName = "Supplier Display Name is required";
      else if (name.length < 2 || name.length > 100)
        newErrors.supplierName = "Must be between 2 and 100 characters";

      if (!regName) newErrors.registeredCompanyName = "Registered Company Name is required";
      else if (regName.length < 2 || regName.length > 200)
        newErrors.registeredCompanyName = "Must be between 2 and 200 characters";

      if (!formData.vendorType) newErrors.vendorType = "Please select a Vendor Type";
      if (formData.category.length === 0)
        newErrors.category = "Please select at least one Category";
      if (formData.mainMaterials.length === 0)
        newErrors.mainMaterials = "Please select at least one material";

      if (!industry) newErrors.industry = "Industry is required";
      else if (industry.length < 2 || industry.length > 100)
        newErrors.industry = "Must be between 2 and 100 characters";

      if (!gstin) newErrors.gstin = "GSTIN is required";
      else if (gstin.length !== 15) newErrors.gstin = "Must be exactly 15 characters";
      else if (
        !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(gstin.toUpperCase())
      ) {
        newErrors.gstin = "Invalid GSTIN format (e.g. 29ABCDE1234F1Z5)";
      }

      // Backend Duplicate Check
      if (Object.keys(newErrors).length === 0) {
        try {
          const existence = await api.checkSupplierExistence({
            company_name: regName,
            gstin: gstin,
          });
          if (existence.company_name)
            newErrors.registeredCompanyName = "This company is already registered";
          if (existence.gstin) newErrors.gstin = "This GSTIN is already registered";
        } catch (e) {
          console.error("Duplicate check failed", e);
        }
      }
    }

    if (step === 2) {
      const addr = formData.address.registeredAddress.trim();
      const city = formData.address.city.trim();
      const state = formData.address.state.trim();
      const pincode = formData.address.pincode.trim();
      const contactName = formData.contact.primaryContactName.trim();
      const designation = formData.contact.designation.trim();
      const phone = formData.contact.phone.trim();
      const website = formData.contact.website.trim();
      const primaryEmail = formData.contact.primaryEmail.trim();
      const secondaryEmail = formData.contact.secondaryEmail.trim();

      // Address Validation (Strict validation removed for registered address)
      if (addr && addr.length > 500)
        newErrors["address.registeredAddress"] = "Must be under 500 characters";

      if (!city) newErrors["address.city"] = "City is required";
      else if (city.length < 2 || city.length > 100)
        newErrors["address.city"] = "Must be between 2 and 100 characters";
      else if (!/^[a-zA-Z\s-]+$/.test(city))
        newErrors["address.city"] = "Only letters, spaces and hyphens allowed";

      if (state && (state.length < 2 || state.length > 100))
        newErrors["address.state"] = "Must be between 2 and 100 characters";

      if (!pincode) newErrors["address.pincode"] = "Pincode is required";
      else if (!/^\d{6}$/.test(pincode)) newErrors["address.pincode"] = "Must be exactly 6 digits";

      // Contact Validation
      if (!contactName)
        newErrors["contact.primaryContactName"] = "Primary Contact Name is required";
      else if (contactName.length < 2 || contactName.length > 100)
        newErrors["contact.primaryContactName"] = "Must be between 2 and 100 characters";
      else if (!/^[a-zA-Z\s]+$/.test(contactName))
        newErrors["contact.primaryContactName"] = "Only letters and spaces allowed";

      if (designation && (designation.length < 2 || designation.length > 100))
        newErrors["contact.designation"] = "Must be between 2 and 100 characters";

      if (!phone) newErrors["contact.phone"] = "Phone number is required";
      else if (!/^[6-9]\d{9}$/.test(phone))
        newErrors["contact.phone"] = "Must be a 10-digit Indian mobile number";

      if (website) {
        try {
          new URL(website.startsWith("http") ? website : `https://${website}`);
        } catch (_) {
          newErrors["contact.website"] = "Please enter a valid URL";
        }
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!primaryEmail) newErrors["contact.primaryEmail"] = "Primary Email is required";
      else if (!emailRegex.test(primaryEmail))
        newErrors["contact.primaryEmail"] = "Invalid email format";

      if (secondaryEmail && !emailRegex.test(secondaryEmail))
        newErrors["contact.secondaryEmail"] = "Invalid email format";

      // Backend Duplicate Check
      if (Object.keys(newErrors).length === 0) {
        try {
          const existence = await api.checkSupplierExistence({
            email: primaryEmail,
            phone: phone,
          });
          if (existence.email) newErrors["contact.primaryEmail"] = "This email is already in use";
          if (existence.phone) newErrors["contact.phone"] = "This phone number is already in use";
        } catch (e) {
          console.error("Duplicate check failed", e);
        }
      }
    }

    if (step === 3) {
      const bankName = formData.bankInfo.bankName.trim();
      const accNo = formData.bankInfo.accountNumber.trim();
      const ifsc = formData.bankInfo.ifsc.trim();
      const holder = formData.bankInfo.accountHolderName.trim();
      const branch = formData.bankInfo.branch.trim();
      const swift = formData.bankInfo.swiftBic.trim();

      if (!bankName) newErrors["bankInfo.bankName"] = "Bank name is required";

      if (!accNo) newErrors["bankInfo.accountNumber"] = "Account number is required";
      else if (accNo.length < 9 || accNo.length > 18)
        newErrors["bankInfo.accountNumber"] = "Must be between 9 and 18 digits";
      else if (!/^\d+$/.test(accNo))
        newErrors["bankInfo.accountNumber"] = "Must contain only digits";

      if (!ifsc) newErrors["bankInfo.ifsc"] = "IFSC code is required";
      else if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.toUpperCase())) {
        newErrors["bankInfo.ifsc"] = "Invalid IFSC format (e.g. SBIN0012345)";
      }

      if (!holder) newErrors["bankInfo.accountHolderName"] = "Account holder name is required";
      else if (!/^[a-zA-Z\s.]+$/.test(holder))
        newErrors["bankInfo.accountHolderName"] = "Invalid characters in name";

      if (!branch) newErrors["bankInfo.branch"] = "Branch name is required";

      if (swift && !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(swift.toUpperCase())) {
        newErrors["bankInfo.swiftBic"] = "Invalid SWIFT/BIC format";
      }

      // Backend Duplicate Check for Account Number
      if (Object.keys(newErrors).length === 0) {
        try {
          const existence = await api.checkSupplierExistence({
            account_number: accNo,
            swift: swift,
          });
          if (existence.account_number)
            newErrors["bankInfo.accountNumber"] = "This bank account is already registered";
          if (existence.swift) newErrors["bankInfo.swiftBic"] = "This SWIFT/BIC is already in use";
        } catch (e) {
          console.error("Duplicate check failed", e);
        }
      }
    }

    if (step === 4) {
      const hasGstCertificate = formData.documents.some(
        (d) => d.document_type === "GST Certificate",
      );
      const hasCancelledCheque = formData.documents.some(
        (d) => d.document_type === "Cancelled Cheque",
      );
      const missingDocs = [
        !hasGstCertificate ? "GST Certificate" : null,
        !hasCancelledCheque ? "Cancelled Cheque" : null,
      ].filter(Boolean);
      if (missingDocs.length > 0) {
        const message = `${missingDocs.join(" and ")} ${missingDocs.length === 1 ? "is" : "are"} mandatory`;
        newErrors["documents"] = message;
        toast.error(`${message} for registration`);
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = async () => {
    setIsSubmitting(true);
    const isValid = await validateStep(currentStep);
    setIsSubmitting(false);
    if (isValid) {
      if (currentStep < 5) setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const response = await api.uploadSupplierDocument(type, file);
      // Keep all metadata returned from server to satisfy CreateSupplierRequest schema
      const newDoc = {
        document_type: response.document_type,
        file_name: response.file_name,
        file_type: response.file_type,
        file_size: response.file_size,
        storage_path: response.storage_path,
        upload_id: response.upload_id,
      };
      setFormData((prev) => ({
        ...prev,
        documents: [...prev.documents, newDoc],
      }));
      toast.success(`${type} uploaded successfully`);
    } catch (e: any) {
      toast.error("Upload failed: " + e.message);
    } finally {
      setIsUploading(true);
      setIsUploading(false);
    }
  };

  const removeDocument = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      documents: prev.documents.filter((_, i) => i !== index),
    }));
  };

  const toggleMainMaterial = (material: string) => {
    setFormData((prev) => {
      const current = prev.mainMaterials || [];
      const updated = current.includes(material)
        ? current.filter((m) => m !== material)
        : [...current, material];
      return { ...prev, mainMaterials: updated };
    });
  };

  const toggleCategory = (cat: string) => {
    setFormData((prev) => {
      const current = prev.category || [];
      const updated = current.includes(cat) ? current.filter((c) => c !== cat) : [...current, cat];
      return { ...prev, category: updated };
    });
  };

  const handleAddVendorType = async () => {
    if (!newVendorType.trim()) {
      toast.error("Please enter a vendor type name");
      return;
    }
    if (vendorTypes.includes(newVendorType.trim())) {
      toast.error("This vendor type already exists");
      return;
    }

    try {
      await api.createVendorType(newVendorType.trim());
      setVendorTypes((prev) => [...prev, newVendorType.trim()]);
      updateFormData("root", "vendorType", newVendorType.trim());
      setNewVendorType("");
      setShowAddVendorType(false);
      toast.success("New vendor type added to database!");
    } catch (e: any) {
      toast.error("Failed to save vendor type: " + e.message);
    }
  };

  const handleAddCategory = async () => {
    if (!newCategory.trim()) {
      toast.error("Please enter a category name");
      return;
    }
    if (categories.includes(newCategory.trim())) {
      toast.error("This category already exists");
      return;
    }

    try {
      await api.createSupplierCategory(newCategory.trim());
      setCategories((prev) => [...prev, newCategory.trim()]);
      toggleCategory(newCategory.trim());
      setNewCategory("");
      setShowAddCategory(false);
      toast.success("New category added to database!");
    } catch (e: any) {
      toast.error("Failed to save category: " + e.message);
    }
  };

  const handleAddRawMaterial = async () => {
    if (!newRawMaterial.trim()) {
      toast.error("Please enter a material name");
      return;
    }
    if (rawMaterials.includes(newRawMaterial.trim())) {
      toast.error("This material already exists");
      return;
    }

    try {
      await api.createRawMaterial(newRawMaterial.trim());
      setRawMaterials((prev) => [...prev, newRawMaterial.trim()]);
      toggleMainMaterial(newRawMaterial.trim());
      setNewRawMaterial("");
      setShowAddRawMaterial(false);
      toast.success("New raw material added to database!");
    } catch (e: any) {
      toast.error("Failed to save material: " + e.message);
    }
  };

  const handleSubmit = async () => {
    // Final validation before submission
    setIsSubmitting(true);
    const step1Valid = await validateStep(1);
    const step2Valid = await validateStep(2);
    const step3Valid = await validateStep(3);
    const step4Valid = await validateStep(4);
    setIsSubmitting(false);

    if (!step1Valid || !step2Valid || !step3Valid || !step4Valid) {
      toast.error("Please fix errors in previous steps before submitting.");
      return;
    }

    const name = formData.supplierName.trim();
    const regName = formData.registeredCompanyName.trim();
    const industry = formData.industry.trim();
    const gstin = formData.gstin.trim();

    setIsSubmitting(true);
    try {
      const finalData = {
        ...formData,
        supplierName: name,
        registeredCompanyName: regName,
        industry: industry,
        gstin: gstin.toUpperCase(),
        creditPeriodDays: formData.creditPeriodDays ? Number(formData.creditPeriodDays) : undefined,
        address: {
          ...formData.address,
          registeredAddress: formData.address.registeredAddress.trim(),
          city: formData.address.city.trim(),
          pincode: formData.address.pincode.trim(),
        },
        contact: {
          ...formData.contact,
          primaryContactName: formData.contact.primaryContactName.trim(),
          primaryEmail: formData.contact.primaryEmail.trim(),
          phone: formData.contact.phone.trim(),
        },
      };
      await api.createSupplier(finalData);
      toast.success("Supplier sent for manager approval", {
        description: `${name} has been added to the supplier approval queue.`,
      });
      window.dispatchEvent(new Event("suppliers:changed"));
      if (currentModule === "manager") {
        navigate({
          to: "/master-data",
          search: { module: "manager", status: "pending-approval" } as any,
        });
      } else {
        navigate({ to: "/master-data", search: { status: "pending-approval" } as any });
      }
    } catch (error: any) {
      toast.error("Failed to register supplier", {
        description: error.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppShell
      title="Register New Supplier"
      subtitle="Complete the 5-step onboarding process to add a new vendor."
    >
      <div className="mx-auto max-w-4xl">
        {/* Step Indicator */}
        <div className="mb-8 flex items-center justify-between">
          {steps.map((step, idx) => (
            <React.Fragment key={step.id}>
              <button
                type="button"
                onClick={() => setCurrentStep(step.id)}
                className="flex flex-col items-center gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all",
                    currentStep === step.id
                      ? "border-primary bg-primary text-primary-foreground shadow-glow"
                      : currentStep > step.id
                        ? "border-success bg-success text-success-foreground"
                        : "border-muted bg-muted text-muted-foreground",
                  )}
                >
                  {currentStep > step.id ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : (
                    <step.icon className="h-5 w-5" />
                  )}
                </div>
                <span
                  className={cn(
                    "text-xs font-medium",
                    currentStep === step.id ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {step.name}
                </span>
              </button>
              {idx < steps.length - 1 && (
                <div
                  className={cn(
                    "h-px flex-1 bg-muted transition-all",
                    currentStep > step.id && "bg-success",
                  )}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        <Card className="p-6 shadow-soft">
          {/* Step 1: Company Profile */}
          {currentStep === 1 && (
            <div className="space-y-4 animate-fade-in">
              <h3 className="text-lg font-semibold">Company Profile</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="supplierName">
                    Supplier Display Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="supplierName"
                    value={formData.supplierName}
                    onChange={(e) => {
                      const sanitized = e.target.value.replace(/[^a-zA-Z\s]/g, "");
                      updateFormData("root", "supplierName", sanitized);
                    }}
                    placeholder="e.g. Acme Corp"
                    className={cn(
                      errors.supplierName && "border-destructive focus-visible:ring-destructive",
                    )}
                  />
                  {errors.supplierName && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {errors.supplierName}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="regName">
                    Registered Company Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="regName"
                    value={formData.registeredCompanyName}
                    onChange={(e) => {
                      const sanitized = e.target.value.replace(/[^a-zA-Z\s]/g, "");
                      updateFormData("root", "registeredCompanyName", sanitized);
                    }}
                    placeholder="Full legal name"
                    className={cn(
                      errors.registeredCompanyName &&
                        "border-destructive focus-visible:ring-destructive",
                    )}
                  />
                  {errors.registeredCompanyName && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {errors.registeredCompanyName}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    Vendor Type <span className="text-destructive">*</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                            <Info className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs font-normal">
                          Defines the type of supplier, such as Manufacturer, Distributor, Trader,
                          or Service Provider.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Select
                    onValueChange={(v) => updateFormData("root", "vendorType", v)}
                    value={formData.vendorType}
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
                      <div className="px-2 py-2 border-t border-border mt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start text-primary font-bold h-8 px-2"
                          onClick={(e) => {
                            e.preventDefault();
                            setShowAddVendorType(true);
                          }}
                        >
                          <Plus className="mr-2 size-3" /> Add New Vendor Type
                        </Button>
                      </div>
                    </SelectContent>
                  </Select>
                  {errors.vendorType && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {errors.vendorType}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    Category <span className="text-destructive">*</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                            <Info className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs font-normal">
                          Select the procurement category that best represents the supplier's
                          products or services.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
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
                          {formData.category?.length > 0
                            ? formData.category.join(", ")
                            : "Select categories"}
                        </span>
                        <ChevronRight className="ml-2 h-4 w-4 shrink-0 opacity-50 rotate-90" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0 rounded-xl" align="start">
                      <div className="p-2 space-y-1 max-h-[300px] overflow-y-auto">
                        {categories.map((cat) => (
                          <div
                            key={cat}
                            className="flex items-center space-x-2 p-2 hover:bg-muted rounded-lg cursor-pointer"
                            onClick={() => toggleCategory(cat)}
                          >
                            <Checkbox
                              id={`cat-${cat}`}
                              checked={formData.category?.includes(cat)}
                              onCheckedChange={() => toggleCategory(cat)}
                            />
                            <Label htmlFor={`cat-${cat}`} className="text-sm cursor-pointer w-full">
                              {cat}
                            </Label>
                          </div>
                        ))}
                      </div>
                      <div className="p-2 border-t border-border">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start text-primary font-bold h-8 px-2"
                          onClick={(e) => {
                            e.preventDefault();
                            setShowAddCategory(true);
                          }}
                        >
                          <Plus className="mr-2 size-3" /> Add New Category
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                  {errors.category && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {errors.category}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    Main Raw Materials <span className="text-destructive">*</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                            <Info className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs font-normal">
                          Select the primary materials or products supplied by this vendor.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className={cn(
                          "w-full justify-between rounded-xl h-10 px-3 font-normal",
                          errors.mainMaterials && "border-destructive",
                        )}
                      >
                        <span className="truncate">
                          {formData.mainMaterials?.length > 0
                            ? formData.mainMaterials.join(", ")
                            : "Select materials"}
                        </span>
                        <ChevronRight className="ml-2 h-4 w-4 shrink-0 opacity-50 rotate-90" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0 rounded-xl" align="start">
                      <div className="p-2 space-y-1 max-h-[300px] overflow-y-auto">
                        {rawMaterials.map((mat) => (
                          <div
                            key={mat}
                            className="flex items-center space-x-2 p-2 hover:bg-muted rounded-lg cursor-pointer"
                            onClick={() => toggleMainMaterial(mat)}
                          >
                            <Checkbox
                              id={`mat-${mat}`}
                              checked={formData.mainMaterials?.includes(mat)}
                              onCheckedChange={() => toggleMainMaterial(mat)}
                            />
                            <Label htmlFor={`mat-${mat}`} className="text-sm cursor-pointer w-full">
                              {mat}
                            </Label>
                          </div>
                        ))}
                      </div>
                      <div className="p-2 border-t border-border">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-start text-primary font-bold h-8 px-2"
                          onClick={(e) => {
                            e.preventDefault();
                            setShowAddRawMaterial(true);
                          }}
                        >
                          <Plus className="mr-2 size-3" /> Add New Material
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                  {errors.mainMaterials && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {errors.mainMaterials}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="industry" className="flex items-center gap-1.5">
                    Industry <span className="text-destructive">*</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                            <Info className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs font-normal">
                          Enter the industry in which the supplier primarily operates.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Input
                    id="industry"
                    value={formData.industry}
                    onChange={(e) => updateFormData("root", "industry", e.target.value)}
                    placeholder="e.g. Chemical, Electronics"
                    className={cn(
                      errors.industry && "border-destructive focus-visible:ring-destructive",
                    )}
                  />
                  {errors.industry && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {errors.industry}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gstin" className="flex items-center gap-1.5">
                    GSTIN <span className="text-destructive">*</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                            <Info className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs font-normal">
                          Enter the supplier's 15-digit Goods and Services Tax Identification Number
                          (GSTIN).
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Input
                    id="gstin"
                    value={formData.gstin}
                    maxLength={15}
                    onChange={(e) => {
                      const val = e.target.value.substring(0, 15);
                      updateFormData("root", "gstin", val);
                    }}
                    placeholder="15-digit GST number"
                    className={cn(
                      "font-mono",
                      errors.gstin && "border-destructive focus-visible:ring-destructive",
                    )}
                  />
                  {errors.gstin && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {errors.gstin}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Address & Contact */}
          {currentStep === 2 && (
            <div className="space-y-4 animate-fade-in">
              <h3 className="text-lg font-semibold">Address & Primary Contact</h3>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="address" className="flex items-center gap-1.5">
                    Registered Address
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                            <Info className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs font-normal">
                          Official registered business address of the vendor for legal and invoicing
                          purposes.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Textarea
                    id="address"
                    value={formData.address.registeredAddress}
                    onChange={(e) => updateFormData("address", "registeredAddress", e.target.value)}
                    placeholder="Plot no, Building, Street..."
                    className={cn(
                      errors["address.registeredAddress"] &&
                        "border-destructive focus-visible:ring-destructive",
                    )}
                  />
                  {errors["address.registeredAddress"] && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {errors["address.registeredAddress"]}
                    </p>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="city">
                      City <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="city"
                      value={formData.address.city}
                      onChange={(e) => updateFormData("address", "city", e.target.value)}
                      className={cn(
                        errors["address.city"] &&
                          "border-destructive focus-visible:ring-destructive",
                      )}
                    />
                    {errors["address.city"] && (
                      <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                        <AlertCircle className="size-3" /> {errors["address.city"]}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="state">State</Label>
                    <Select
                      onValueChange={(v) => updateFormData("address", "state", v)}
                      value={formData.address.state}
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
                  <div className="space-y-2">
                    <Label htmlFor="pincode" className="flex items-center gap-1.5">
                      Pincode <span className="text-destructive">*</span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                              <Info className="size-3.5" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs font-normal">
                            6-digit postal code. Entering a valid pincode will auto-populate City
                            and State.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </Label>
                    <div className="relative">
                      <Input
                        id="pincode"
                        value={formData.address.pincode}
                        maxLength={6}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "").substring(0, 6);
                          updateFormData("address", "pincode", val);
                        }}
                        className={cn(
                          "pr-9",
                          errors["address.pincode"] &&
                            "border-destructive focus-visible:ring-destructive",
                        )}
                        placeholder="6-digit PIN"
                      />
                      {isLookingUpPincode && (
                        <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                      )}
                    </div>
                    {errors["address.pincode"] && (
                      <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                        <AlertCircle className="size-3" /> {errors["address.pincode"]}
                      </p>
                    )}
                  </div>
                </div>
                <div className="border-t pt-4 mt-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="contactName" className="flex items-center gap-1.5">
                        Primary Contact Name <span className="text-destructive">*</span>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                                <Info className="size-3.5" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs font-normal">
                              Full name of the primary contact person responsible for procurement
                              communication.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </Label>
                      <Input
                        id="contactName"
                        value={formData.contact.primaryContactName}
                        onChange={(e) =>
                          updateFormData("contact", "primaryContactName", e.target.value)
                        }
                        className={cn(
                          errors["contact.primaryContactName"] &&
                            "border-destructive focus-visible:ring-destructive",
                        )}
                      />
                      {errors["contact.primaryContactName"] && (
                        <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                          <AlertCircle className="size-3" /> {errors["contact.primaryContactName"]}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="designation">Designation</Label>
                      <Input
                        id="designation"
                        value={formData.contact.designation}
                        onChange={(e) => updateFormData("contact", "designation", e.target.value)}
                        className={cn(
                          errors["contact.designation"] &&
                            "border-destructive focus-visible:ring-destructive",
                        )}
                      />
                      {errors["contact.designation"] && (
                        <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                          <AlertCircle className="size-3" /> {errors["contact.designation"]}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone" className="flex items-center gap-1.5">
                        Phone <span className="text-destructive">*</span>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                                <Info className="size-3.5" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs font-normal">
                              10-digit primary contact phone number for operational and procurement
                              queries.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </Label>
                      <Input
                        id="phone"
                        value={formData.contact.phone}
                        maxLength={10}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, "").substring(0, 10);
                          updateFormData("contact", "phone", val);
                        }}
                        className={cn(
                          errors["contact.phone"] &&
                            "border-destructive focus-visible:ring-destructive",
                        )}
                        placeholder="10-digit mobile number"
                      />
                      {errors["contact.phone"] && (
                        <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                          <AlertCircle className="size-3" /> {errors["contact.phone"]}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="website">Website</Label>
                      <Input
                        id="website"
                        type="url"
                        value={formData.contact.website}
                        onChange={(e) => updateFormData("contact", "website", e.target.value)}
                        className={cn(
                          errors["contact.website"] &&
                            "border-destructive focus-visible:ring-destructive",
                        )}
                        placeholder="https://example.com"
                      />
                      {errors["contact.website"] && (
                        <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                          <AlertCircle className="size-3" /> {errors["contact.website"]}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="primaryEmail" className="flex items-center gap-1.5">
                        Primary Email (Main) <span className="text-destructive">*</span>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                                <Info className="size-3.5" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs font-normal">
                              Main email address used for purchase orders, RFQs, and official
                              notifications.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </Label>
                      <Input
                        id="primaryEmail"
                        type="email"
                        value={formData.contact.primaryEmail}
                        maxLength={128}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\s/g, "").substring(0, 128);
                          updateFormData("contact", "primaryEmail", val);

                          // Run-time validation
                          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                          if (val && !emailRegex.test(val)) {
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
                        placeholder="main@company.com"
                        className={cn(
                          errors["contact.primaryEmail"] &&
                            "border-destructive focus-visible:ring-destructive",
                        )}
                      />
                      {errors["contact.primaryEmail"] && (
                        <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                          <AlertCircle className="size-3" /> {errors["contact.primaryEmail"]}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="secondaryEmail" className="flex items-center gap-1.5">
                        Secondary Email (Reference)
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                                <Info className="size-3.5" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs font-normal">
                              Secondary or department email address for copy (CC) and backup
                              communication.
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </Label>
                      <Input
                        id="secondaryEmail"
                        type="email"
                        value={formData.contact.secondaryEmail}
                        maxLength={128}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\s/g, "").substring(0, 128);
                          updateFormData("contact", "secondaryEmail", val);

                          // Run-time validation
                          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                          if (val && !emailRegex.test(val)) {
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
                        placeholder="reference@company.com"
                        className={cn(
                          errors["contact.secondaryEmail"] &&
                            "border-destructive focus-visible:ring-destructive",
                        )}
                      />
                      {errors["contact.secondaryEmail"] && (
                        <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                          <AlertCircle className="size-3" /> {errors["contact.secondaryEmail"]}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Banking Information */}
          {currentStep === 3 && (
            <div className="space-y-4 animate-fade-in">
              <h3 className="text-lg font-semibold">Banking Information</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="bankName" className="flex items-center gap-1.5">
                    Bank Name <span className="text-destructive">*</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                            <Info className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs font-normal">
                          Name of the financial institution where the supplier holds their primary
                          business account.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Input
                    id="bankName"
                    value={formData.bankInfo.bankName}
                    onChange={(e) => updateFormData("bankInfo", "bankName", e.target.value)}
                    className={cn(
                      errors["bankInfo.bankName"] &&
                        "border-destructive focus-visible:ring-destructive",
                    )}
                  />
                  {errors["bankInfo.bankName"] && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {errors["bankInfo.bankName"]}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="accNo" className="flex items-center gap-1.5">
                    Account Number <span className="text-destructive">*</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                            <Info className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs font-normal">
                          Supplier's bank account number for processing electronic fund transfers
                          (NEFT/RTGS/IMPS).
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Input
                    id="accNo"
                    value={formData.bankInfo.accountNumber}
                    maxLength={18}
                    onChange={async (e) => {
                      const val = e.target.value.replace(/\D/g, "").substring(0, 18);
                      updateFormData("bankInfo", "accountNumber", val);

                      // Run-time validation for duplicates
                      if (val.length >= 9) {
                        try {
                          const existence = await api.checkSupplierExistence({
                            account_number: val,
                          });
                          if (existence.account_number) {
                            setErrors((prev) => ({
                              ...prev,
                              ["bankInfo.accountNumber"]: "This account number already exists",
                            }));
                          } else {
                            setErrors((prev) => {
                              const next = { ...prev };
                              delete next["bankInfo.accountNumber"];
                              return next;
                            });
                          }
                        } catch (err) {
                          console.error("Runtime duplicate check failed", err);
                        }
                      }
                    }}
                    className={cn(
                      errors["bankInfo.accountNumber"] &&
                        "border-destructive focus-visible:ring-destructive",
                    )}
                  />
                  {errors["bankInfo.accountNumber"] && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {errors["bankInfo.accountNumber"]}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ifsc" className="flex items-center gap-1.5">
                    IFSC Code <span className="text-destructive">*</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                            <Info className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs font-normal">
                          11-character Indian Financial System Code for bank branch identification.
                          Auto-fetches bank and branch.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <div className="relative">
                    <Input
                      id="ifsc"
                      value={formData.bankInfo.ifsc}
                      maxLength={11}
                      onChange={(e) => {
                        const val = e.target.value
                          .replace(/[^a-zA-Z0-9]/g, "")
                          .substring(0, 11)
                          .toUpperCase();
                        updateFormData("bankInfo", "ifsc", val);
                        if (val.length === 11) void lookupIfsc(val);
                      }}
                      className={cn(
                        "pr-10 font-mono",
                        errors["bankInfo.ifsc"] &&
                          "border-destructive focus-visible:ring-destructive",
                      )}
                      placeholder="e.g. SBIN0012345"
                    />
                    {isLookingUpIfsc && (
                      <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-primary" />
                    )}
                  </div>
                  {errors["bankInfo.ifsc"] && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {errors["bankInfo.ifsc"]}
                    </p>
                  )}
                  {!errors["bankInfo.ifsc"] && (
                    <p className="text-[11px] text-muted-foreground">
                      Bank and branch are filled automatically after 11 characters.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="holder" className="flex items-center gap-1.5">
                    Account Holder Name <span className="text-destructive">*</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                            <Info className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs font-normal">
                          Name of the account holder as registered with the bank for payment
                          verification.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Input
                    id="holder"
                    value={formData.bankInfo.accountHolderName}
                    onChange={(e) =>
                      updateFormData("bankInfo", "accountHolderName", e.target.value)
                    }
                    className={cn(
                      errors["bankInfo.accountHolderName"] &&
                        "border-destructive focus-visible:ring-destructive",
                    )}
                  />
                  {errors["bankInfo.accountHolderName"] && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {errors["bankInfo.accountHolderName"]}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="branch" className="flex items-center gap-1.5">
                    Branch <span className="text-destructive">*</span>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                            <Info className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs font-normal">
                          Specific bank branch location where the account is maintained.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Input
                    id="branch"
                    value={formData.bankInfo.branch}
                    onChange={(e) => updateFormData("bankInfo", "branch", e.target.value)}
                    className={cn(
                      errors["bankInfo.branch"] &&
                        "border-destructive focus-visible:ring-destructive",
                    )}
                  />
                  {errors["bankInfo.branch"] && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {errors["bankInfo.branch"]}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="swiftBic" className="flex items-center gap-1.5">
                    SWIFT / BIC
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                            <Info className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs font-normal">
                          8 or 11-character SWIFT/BIC code required for international wire
                          transfers.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Input
                    id="swiftBic"
                    value={formData.bankInfo.swiftBic}
                    maxLength={11}
                    onChange={(e) => {
                      const val = e.target.value
                        .replace(/[^a-zA-Z0-9]/g, "")
                        .substring(0, 11)
                        .toUpperCase();
                      updateFormData("bankInfo", "swiftBic", val);
                    }}
                    className={cn(
                      "font-mono",
                      errors["bankInfo.swiftBic"] &&
                        "border-destructive focus-visible:ring-destructive",
                    )}
                  />
                  {errors["bankInfo.swiftBic"] && (
                    <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {errors["bankInfo.swiftBic"]}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tdsSection" className="flex items-center gap-1.5">
                    TDS Section
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                            <Info className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs font-normal">
                          Applicable Tax Deducted at Source (TDS) section under Income Tax Act for
                          tax withholding.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Select
                    onValueChange={(v) => updateFormData("bankInfo", "tdsSection", v)}
                    value={formData.bankInfo.tdsSection}
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
                <div className="space-y-2">
                  <Label htmlFor="paymentTerms" className="flex items-center gap-1.5">
                    Payment Terms
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                            <Info className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs font-normal">
                          Agreed commercial terms governing payment schedules (e.g. Net 30, Net 60,
                          Advance).
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Select
                    onValueChange={(v) => updateFormData("root", "paymentTerms", v)}
                    value={formData.paymentTerms}
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
                <div className="space-y-2">
                  <Label htmlFor="creditPeriodDays" className="flex items-center gap-1.5">
                    Credit Period (Days)
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                            <Info className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs font-normal">
                          Number of credit days allowed by the supplier from invoice or GRN date
                          before payment is due.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Input
                    id="creditPeriodDays"
                    value={formData.creditPeriodDays}
                    maxLength={3}
                    onChange={(e) =>
                      updateFormData(
                        "root",
                        "creditPeriodDays",
                        e.target.value.replace(/\D/g, "").substring(0, 3),
                      )
                    }
                    placeholder="e.g. 30"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="modeOfPayment" className="flex items-center gap-1.5">
                    Mode of Payment
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                            <Info className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs font-normal">
                          Preferred payment channel for supplier settlements.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Select
                    onValueChange={(v) => updateFormData("root", "modeOfPayment", v)}
                    value={formData.modeOfPayment}
                  >
                    <SelectTrigger id="modeOfPayment">
                      <SelectValue placeholder="Select mode of payment" />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        "NEFT",
                        "RTGS",
                        "IMPS",
                        "UPI",
                        "Cheque",
                        "Demand Draft",
                        "Wire Transfer",
                      ].map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {mode}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Documents */}
          {currentStep === 4 && (
            <div className="space-y-4 animate-fade-in">
              <h3 className="text-lg font-semibold">Supporting Documents</h3>
              <p className="text-sm text-muted-foreground">
                Upload copies of legal and tax documents for verification.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  {
                    name: "GST Certificate",
                    mandatory: true,
                    tooltip:
                      "Official GST Registration Certificate (Form REG-06) issued by tax authorities.",
                  },
                  {
                    name: "Cancelled Cheque",
                    mandatory: true,
                    tooltip:
                      "Copy of a cancelled cheque or bank statement showing account number and IFSC for bank verification.",
                  },
                  {
                    name: "Vendor Code of Conduct",
                    mandatory: false,
                    tooltip: "Signed copy of the vendor ethics policy or compliance agreement.",
                  },
                  {
                    name: "Other",
                    mandatory: false,
                    tooltip:
                      "Any additional licenses, ISO certifications, PAN, or supporting commercial documents.",
                  },
                ].map((doc) => (
                  <div key={doc.name} className="relative">
                    <input
                      type="file"
                      id={`file-${doc.name}`}
                      className="hidden"
                      onChange={(e) => handleFileUpload(e, doc.name)}
                      disabled={isUploading}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-24 flex-col gap-2 rounded-xl border-dashed border-2 hover:border-primary/50 hover:bg-primary/5"
                      onClick={() => document.getElementById(`file-${doc.name}`)?.click()}
                      disabled={isUploading}
                    >
                      {isUploading ? (
                        <Loader2 className="size-5 animate-spin" />
                      ) : formData.documents.some((d) => d.document_type === doc.name) ? (
                        <CheckCircle2 className="size-5 text-success" />
                      ) : (
                        <Plus className="size-5" />
                      )}
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold">
                        <span>{doc.name}</span>
                        {doc.mandatory && <span className="text-destructive">*</span>}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Info className="size-3" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-xs font-normal normal-case">
                              {doc.tooltip}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </span>
                    </Button>
                  </div>
                ))}
              </div>

              {errors["documents"] && (
                <p className="text-[11px] font-medium text-destructive flex items-center gap-1">
                  <AlertCircle className="size-3" /> {errors["documents"]}
                </p>
              )}

              {formData.documents.length > 0 && (
                <div className="mt-8 space-y-2">
                  <Label className="text-xs text-muted-foreground">Uploaded Documents</Label>
                  <div className="grid gap-2">
                    {formData.documents.map((doc, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 rounded-xl bg-muted/30 border border-border/50"
                      >
                        <div className="flex items-center gap-3">
                          <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                            <FileIcon className="size-4" />
                          </div>
                          <div>
                            <div className="text-sm font-medium">{doc.file_name}</div>
                            <div className="text-[10px] text-muted-foreground uppercase">
                              {doc.document_type}
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive hover:bg-destructive/10 rounded-lg"
                          onClick={() => removeDocument(idx)}
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 5: Remarks */}
          {currentStep === 5 && (
            <div className="space-y-6 animate-fade-in">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Final Remarks</h3>
                <div className="space-y-2">
                  <Label htmlFor="remarks" className="flex items-center gap-1.5">
                    Additional Information / Justification
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground">
                            <Info className="size-3.5" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs font-normal">
                          Enter any relevant vendor notes, special terms, background context, or
                          registration justification.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </Label>
                  <Textarea
                    id="remarks"
                    value={formData.remarks}
                    onChange={(e) => updateFormData("root", "remarks", e.target.value)}
                    placeholder="Enter any additional notes about this vendor..."
                    className="min-h-[120px] rounded-xl"
                  />
                </div>
              </div>

              <div className="rounded-2xl bg-muted/30 border border-border/50 p-5 space-y-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <AlertCircle className="size-4" />
                  <h4 className="text-xs font-bold uppercase tracking-wider">Audit Information</h4>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground font-bold">
                      Created By
                    </Label>
                    <div className="text-sm font-medium flex items-center gap-2">
                      <div className="size-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] text-primary font-bold">
                        P
                      </div>
                      Procurement Officer (Current Session)
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground font-bold">
                      Registration Date
                    </Label>
                    <div className="text-sm font-medium">
                      {new Date().toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-8 flex items-center justify-between border-t pt-6">
            <Button
              variant="ghost"
              onClick={handleBack}
              disabled={currentStep === 1 || isSubmitting}
            >
              <ChevronLeft className="mr-2 h-4 w-4" /> Back
            </Button>

            {currentStep < 5 ? (
              <Button onClick={handleNext} className="shadow-glow" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Next <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                className="bg-success hover:bg-success/90 shadow-glow"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Registering...
                  </>
                ) : (
                  <>
                    Submit Registration <CheckCircle2 className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            )}
          </div>
        </Card>
      </div>
      <Dialog open={showAddVendorType} onOpenChange={setShowAddVendorType}>
        <DialogContent className="sm:max-w-[425px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="size-5 text-primary" />
              Add Custom Vendor Type
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="custom-vendor-type">Vendor Type Name</Label>
              <Input
                id="custom-vendor-type"
                placeholder="e.g. OEM, Logistics Partner"
                value={newVendorType}
                onChange={(e) => setNewVendorType(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddVendorType(false)}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button onClick={handleAddVendorType} className="rounded-xl bg-primary shadow-glow">
              Add Vendor Type
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddCategory} onOpenChange={setShowAddCategory}>
        <DialogContent className="sm:max-w-[425px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="size-5 text-primary" />
              Add Custom Category
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="custom-category">Category Name</Label>
              <Input
                id="custom-category"
                placeholder="e.g. Chemicals, Electronics"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddCategory(false)}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button onClick={handleAddCategory} className="rounded-xl bg-primary shadow-glow">
              Add Category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddRawMaterial} onOpenChange={setShowAddRawMaterial}>
        <DialogContent className="sm:max-w-[425px] rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="size-5 text-primary" />
              Add Custom Raw Material
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="custom-material">Material Name</Label>
              <Input
                id="custom-material"
                placeholder="e.g. Rare Earth Metals, High-Grade Steel"
                value={newRawMaterial}
                onChange={(e) => setNewRawMaterial(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddRawMaterial(false)}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button onClick={handleAddRawMaterial} className="rounded-xl bg-primary shadow-glow">
              Add Material
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
