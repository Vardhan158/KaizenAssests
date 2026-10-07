import React, { useRef, useState, useEffect } from "react";
import { Camera, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

interface PoCameraScannerProps {
  onOcrSuccess: (data: any, file: File) => void;
  onClose: () => void;
}

function compressImageFile(file: File, maxDim = 1600, quality = 0.9): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          resolve(blob ? new File([blob], file.name, { type: "image/jpeg" }) : file);
        },
        "image/jpeg",
        quality,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

export function PoCameraScanner({ onOcrSuccess, onClose }: PoCameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function startCamera() {
      if (
        typeof window !== "undefined" &&
        (!navigator?.mediaDevices || !navigator?.mediaDevices?.getUserMedia)
      ) {
        if (mounted) {
          setError(
            "Live video streaming is blocked over plain HTTP on mobile browsers. Tap 'Take Photo / Upload Image' to capture a picture with your phone's camera.",
          );
        }
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
          },
          audio: false,
        });
        if (mounted) {
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        } else {
          stream.getTracks().forEach((track) => track.stop());
        }
      } catch (err: any) {
        console.error("Camera access error:", err);
        if (mounted) {
          setError(
            "Camera access is blocked or unavailable over HTTP. Use 'Take Photo / Upload Image' below to snap a picture with your camera app.",
          );
        }
      }
    }
    startCamera();
    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !(file instanceof Blob) || file.size === 0) {
      toast.error("Please capture or upload a document first.");
      return;
    }

    setScanning(true);
    const toastId = toast.loading("Compressing & analyzing PO document...");

    try {
      const compressedFile = await compressImageFile(file);
      const { api } = await import("@/lib/api-client");
      const data = await api.scanOcr(compressedFile, "po");

      const ocrResult = data.ocr_result || data;
      const fields = data.extraction?.fields || ocrResult.extraction?.fields || {};
      const hasPo = ocrResult.po_number || fields.po_number || ocrResult.supplier_name || fields.supplier_name;

      if (!hasPo) {
        toast.info(
          "No readable purchase-order details were found. Use a clearer document image or enter the details manually.",
          { id: toastId },
        );
      } else {
        toast.success("OCR Extraction Complete", { id: toastId });
      }
      onOcrSuccess(data, compressedFile);
      onClose();
    } catch (err: any) {
      console.error("OCR Preview error:", err);
      const msg = String(err?.message || "");
      if (msg.includes("422") || msg.includes("Unprocessable") || msg.includes("empty") || msg.includes("validation")) {
        toast.error("Unable to process the uploaded document. Please try again.", {
          id: toastId,
        });
      } else {
        toast.error("Document scanning failed. Please try again or enter the details manually.", {
          id: toastId,
          description: err.message || "Falling back to manual entry.",
        });
      }
    } finally {
      setScanning(false);
      e.target.value = "";
    }
  };

  async function captureAndScanFrame() {
    if (!videoRef.current || !canvasRef.current) return;
    setScanning(true);
    const toastId = toast.loading("Analyzing PO document...");
    try {
      const canvas = canvasRef.current;
      const video = videoRef.current;

      let w = video.videoWidth || 1280;
      let h = video.videoHeight || 720;
      const maxDim = 1024;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }

      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not initialize canvas context");

      ctx.drawImage(video, 0, 0, w, h);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      const { api } = await import("@/lib/api-client");
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], `po-scan-${Date.now()}.jpg`, { type: "image/jpeg" });
      const data = await api.scanOcr(file, "po");

      const ocrResult = data.ocr_result || data;
      const fields = data.extraction?.fields || ocrResult.extraction?.fields || {};
      const hasPo = ocrResult.po_number || fields.po_number || ocrResult.supplier_name || fields.supplier_name;

      if (!hasPo) {
        toast.info(
          "No readable purchase-order details were found. Use a clearer document image or enter the details manually.",
          { id: toastId },
        );
      } else {
        toast.success("OCR Extraction Complete", { id: toastId });
      }
      onOcrSuccess(data, file);
      onClose();
    } catch (err: any) {
      console.error("OCR Preview error:", err);
      const msg = String(err?.message || "");
      if (msg.includes("422") || msg.includes("Unprocessable") || msg.includes("empty") || msg.includes("validation")) {
        toast.error("Unable to process the uploaded document. Please try again.", {
          id: toastId,
        });
      } else {
        toast.error("Document scanning failed. Please try again or enter the details manually.", {
          id: toastId,
          description: err.message || "Falling back to manual entry.",
        });
      }
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-foreground/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-full w-full max-w-2xl flex-col rounded-3xl bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-border/50 p-5">
          <div>
            <h3 className="text-lg font-bold tracking-tight">Scan Purchase Order</h3>
            <p className="text-xs text-muted-foreground">
              Align the PO document clearly within the frame.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={onClose}
            disabled={scanning}
          >
            <X className="size-5" />
          </Button>
        </div>

        <div className="relative flex-1 bg-black overflow-hidden flex items-center justify-center min-h-[250px]">
          {error ? (
            <div className="p-8 text-center flex flex-col items-center">
              <div className="mx-auto mb-4 rounded-full bg-amber-500/10 p-3 text-amber-500 w-fit">
                <Camera className="size-6" />
              </div>
              <p className="text-sm font-medium text-muted-foreground mb-4 max-w-md">{error}</p>
              <Button
                variant="default"
                className="rounded-xl font-bold shadow-glow"
                onClick={() => fileInputRef.current?.click()}
                disabled={scanning}
              >
                <Camera className="mr-2 size-4" /> Take Photo / Upload Image
              </Button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-contain"
              />
              <div className="absolute inset-0 border-[40px] border-black/40 pointer-events-none flex items-center justify-center">
                <div className="w-full h-full border-2 border-dashed border-primary/40 rounded-lg"></div>
              </div>
            </>
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileUpload}
        />

        <div className="flex items-center justify-end gap-3 border-t border-border/50 p-5">
          <Button variant="outline" className="rounded-xl" onClick={onClose} disabled={scanning}>
            Cancel
          </Button>
          {!error && (
            <Button
              className="rounded-xl px-8 font-bold shadow-glow"
              disabled={scanning}
              onClick={captureAndScanFrame}
            >
              {scanning ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" /> Processing...
                </>
              ) : (
                <>
                  <Camera className="mr-2 size-4" /> Capture & Analyze
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
