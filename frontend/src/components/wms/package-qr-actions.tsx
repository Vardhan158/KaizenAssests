import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { InformationTooltip } from "@/components/ui/information-tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function PackageQrActions({ packageNumber, title = "Package QR", buttonLabel = "View Package QR" }: { packageNumber?: string; title?: string; buttonLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<{ number: string; url: string } | null>(null);
  useEffect(() => {
    let active = true;
    setImage(null);
    setOpen(false);
    if (packageNumber) {
      void QRCode.toDataURL(packageNumber, { width: 512, margin: 4 })
        .then((url) => { if (active) setImage({ number: packageNumber, url }); })
        .catch(() => { if (active) toast.error("Unable to generate package QR."); });
    }
    return () => { active = false; };
  }, [packageNumber]);
  const ready = image?.number === packageNumber && !!image?.url;

  const download = () => {
    if (!ready || !image) return;
    const link = document.createElement("a");
    link.href = image.url;
    link.download = `${image.number}.png`;
    link.click();
  };
  const print = () => {
    if (!ready || !image) return;
    const popup = window.open("", "_blank", "width=700,height=700");
    if (!popup) return toast.error("Allow pop-ups to print the package QR.");
    const doc = popup.document;
    doc.title = `${title} - ${image.number}`;
    const style = doc.createElement("style");
    style.textContent = "@page { margin: 15mm; } body { font: 16px Arial, sans-serif; text-align: center; color: #000; } img { width: 280px; height: 280px; } p { overflow-wrap: anywhere; }";
    doc.head.appendChild(style);
    const heading = doc.createElement("h1");
    heading.textContent = title;
    const label = doc.createElement("p");
    label.textContent = image.number;
    const qr = doc.createElement("img");
    qr.alt = `QR for package ${image.number}`;
    qr.onload = () => { popup.focus(); popup.print(); };
    qr.onerror = () => { popup.close(); toast.error("Unable to load package QR for printing."); };
    doc.body.append(heading, qr, label);
    qr.src = image.url;
  };
  return <>
    <Button type="button" variant="outline" className="rounded-xl" disabled={!ready} onClick={() => setOpen(true)}>
      <Eye className="mr-2 size-4" />{buttonLabel}
    </Button>
    <InformationTooltip help="packageQr" />
    <Dialog open={open && ready} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="break-all">{packageNumber}</DialogDescription>
        </DialogHeader>
        {ready && <img src={image!.url} alt={`QR for package ${packageNumber}`} className="mx-auto w-full max-w-sm rounded-lg bg-white" />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={print}>Print QR</Button>
          <Button type="button" onClick={download}>Download QR</Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
