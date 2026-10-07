import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

type Props = {
    lineId?: string;
    damagedQuantity: number;
    reason?: string;
    onSuccess?: (evidence: { evidenceId: string; fileName?: string; filePath?: string; file?: File }) => void;
    initialPreviewUrl?: string;
    initialFile?: File;
};

// Do not reset photo state when reason or quantity changes, only when the line changes.
export function DamagePhoto(props: Props) {
    return (
        <PhotoEditor
            key={props.lineId ?? "unsaved"}
            {...props}
        />
    );
}

function PhotoEditor({ lineId, damagedQuantity, reason, onSuccess, initialPreviewUrl, initialFile }: Props) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const mounted = useRef(false);
    const uploadLock = useRef(false);
    const captureLock = useRef(false);

    const [cameraOpen, setCameraOpen] = useState(false);
    const [ready, setReady] = useState(false);
    const [file, setFile] = useState<File | null>(initialFile || null);
    const [preview, setPreview] = useState(initialPreviewUrl || "");
    const [uploading, setUploading] = useState(false);
    const [capturing, setCapturing] = useState(false);
    const [saved, setSaved] = useState(!!initialPreviewUrl || !!initialFile);
    const [error, setError] = useState("");

    const validLine = Boolean(lineId?.trim());
    const validQuantity =
        Number.isFinite(damagedQuantity) && damagedQuantity > 0;

    useEffect(() => {
        mounted.current = true;

        return () => {
            mounted.current = false;
        };
    }, []);

    function report(message: string) {
        if (!mounted.current) return;

        setError(message);
        toast.error(message);
    }

    useEffect(() => {
        if (!file) {
            if (initialPreviewUrl) {
                setPreview(initialPreviewUrl);
            } else {
                setPreview("");
            }
            return;
        }

        const url = URL.createObjectURL(file);
        setPreview(url);

        return () => URL.revokeObjectURL(url);
    }, [file, initialPreviewUrl]);

    useEffect(() => {
        if (!cameraOpen) return;

        let cancelled = false;
        let stream: MediaStream | undefined;
        const video = videoRef.current;

        async function openCamera() {
            try {
                if (!navigator.mediaDevices?.getUserMedia) {
                    throw new Error(
                        "Camera requires HTTPS or localhost. Use Upload Photo instead."
                    );
                }

                const opened = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: { ideal: "environment" },
                    },
                    audio: false,
                });

                if (cancelled) {
                    opened.getTracks().forEach((track) => track.stop());
                    return;
                }

                stream = opened;

                if (!video) {
                    throw new Error("Camera preview is unavailable.");
                }

                video.srcObject = stream;
                await video.play();
            } catch (cause) {
                stream?.getTracks().forEach((track) => track.stop());

                if (cancelled) return;

                setCameraOpen(false);
                setReady(false);

                const name = cause instanceof Error ? cause.name : "";

                const message =
                    name === "NotAllowedError"
                        ? "Camera permission denied. Allow camera access in your browser."
                        : name === "NotFoundError"
                            ? "No camera found. Use Upload Photo instead."
                            : name === "NotReadableError"
                                ? "Camera is unavailable or used by another application."
                                : cause instanceof Error
                                    ? cause.message
                                    : "Unable to open camera.";

                report(message);
            }
        }

        void openCamera();

        return () => {
            cancelled = true;
            stream?.getTracks().forEach((track) => track.stop());

            if (video) {
                video.srcObject = null;
            }
        };
    }, [cameraOpen]);

    function choose(selected: File): boolean {
        const allowedTypes = [
            "image/jpeg",
            "image/png",
            "image/webp",
        ];

        if (!allowedTypes.includes(selected.type)) {
            report("Choose a JPG, PNG or WebP photo.");
            return false;
        }

        if (
            selected.size === 0 ||
            selected.size > 5 * 1024 * 1024
        ) {
            report("Choose a non-empty photo of at most 5 MB.");
            return false;
        }

        setFile(selected);
        setSaved(false);
        setError("");

        return true;
    }

    async function capture() {
        const video = videoRef.current;

        if (captureLock.current) return;

        if (!video || !video.videoWidth || !video.videoHeight) {
            report("Wait for the camera preview, then try again.");
            return;
        }

        captureLock.current = true;
        setCapturing(true);

        try {
            const canvas = document.createElement("canvas");

            const scale = Math.min(
                1,
                1600 / Math.max(video.videoWidth, video.videoHeight)
            );

            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);

            const context = canvas.getContext("2d");

            if (!context) {
                throw new Error("Cannot capture a camera frame.");
            }

            context.drawImage(
                video,
                0,
                0,
                canvas.width,
                canvas.height
            );

            const blob = await new Promise<Blob | null>((resolve) => {
                canvas.toBlob(resolve, "image/jpeg", 0.85);
            });

            if (!mounted.current) return;

            if (!blob) {
                throw new Error("Photo capture failed. Please try again.");
            }

            const capturedFile = new File(
                [blob],
                `damage-${Date.now()}.jpg`,
                { type: "image/jpeg" }
            );

            if (choose(capturedFile)) {
                setCameraOpen(false);
                setReady(false);
            }
        } catch (cause) {
            report(
                cause instanceof Error
                    ? cause.message
                    : "Photo capture failed."
            );
        } finally {
            captureLock.current = false;

            if (mounted.current) {
                setCapturing(false);
            }
        }
    }

    async function upload() {
        if (uploadLock.current || saved) return;

        if (!lineId?.trim()) {
            report(
                "Return to Page 2 and click Next to save the material first."
            );
            return;
        }

        if (!validQuantity) {
            report("Damaged quantity must be greater than zero.");
            return;
        }

        if (!file) {
            report("Choose or capture a photo first.");
            return;
        }

        uploadLock.current = true;
        setUploading(true);
        setError("");

        try {
            const data = new FormData();

            data.append("file", file);
            data.append(
                "damaged_quantity",
                String(damagedQuantity)
            );
            if (reason) {
                data.append("reason", reason);
            }

            const result = await api.uploadDamageEvidence(
                lineId.trim(),
                data
            );

            if (!mounted.current) return;

            // Support the backend's camelCase response.
            const evidenceId =
                result?.evidenceId || result?.evidence_id;

            if (!evidenceId) {
                throw new Error(
                    "Server returned no evidence ID. Upload could not be confirmed."
                );
            }

            setSaved(true);
            toast.success("Damage photo saved.");
            onSuccess?.({
                evidenceId: String(evidenceId),
                fileName: file.name,
                filePath: result?.file_path || result?.filePath || "",
                file,
            });
        } catch (cause) {
            report(
                cause instanceof Error
                    ? cause.message
                    : "Upload failed. Please retry."
            );
        } finally {
            uploadLock.current = false;

            if (mounted.current) {
                setUploading(false);
            }
        }
    }

    return (
        <div
            className="min-w-[260px] space-y-3"
            aria-busy={uploading}
        >
            <label className="block text-xs font-semibold">
                Upload Photo

                <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={uploading || cameraOpen || capturing}
                    className="mt-1 block w-full text-xs"
                    onChange={(event) => {
                        const selected = event.currentTarget.files?.[0];

                        if (selected) {
                            choose(selected);
                        }

                        event.currentTarget.value = "";
                    }}
                />
            </label>

            {!cameraOpen && (
                <Button
                    type="button"
                    variant="outline"
                    disabled={uploading || capturing}
                    onClick={() => {
                        setError("");
                        setReady(false);
                        setCameraOpen(true);
                    }}
                >
                    Open Camera
                </Button>
            )}

            {cameraOpen && (
                <div className="space-y-2">
                    <video
                        ref={videoRef}
                        autoPlay
                        muted
                        playsInline
                        onCanPlay={() => setReady(true)}
                        className="w-64 rounded-lg bg-black"
                    />

                    <div className="flex gap-2">
                        <Button
                            type="button"
                            disabled={!ready || capturing}
                            onClick={() => void capture()}
                        >
                            {capturing ? "Capturing..." : "Take Photo"}
                        </Button>

                        <Button
                            type="button"
                            variant="outline"
                            disabled={capturing}
                            onClick={() => {
                                setCameraOpen(false);
                                setReady(false);
                            }}
                        >
                            Close Camera
                        </Button>
                    </div>
                </div>
            )}

            {preview && (
                <img
                    src={preview}
                    alt="Selected damage evidence"
                    className="h-28 w-40 rounded-lg border object-contain"
                />
            )}

            {file && (
                <Button
                    type="button"
                    disabled={
                        uploading ||
                        saved ||
                        cameraOpen ||
                        capturing ||
                        !validLine ||
                        !validQuantity
                    }
                    onClick={() => void upload()}
                >
                    {uploading
                        ? "Uploading..."
                        : saved
                            ? "Photo Saved"
                            : "Save Photo"}
                </Button>
            )}

            {!validLine && (
                <p className="text-xs text-red-600">
                    Return to Page 2 and click Next to save material details.
                </p>
            )}

            {!validQuantity && (
                <p className="text-xs text-red-600">
                    Damaged quantity must be greater than zero.
                </p>
            )}

            {error && (
                <p
                    role="alert"
                    className="text-xs text-red-600 break-words"
                >
                    {error}
                </p>
            )}

            {saved && (
                <p role="status" className="text-xs text-green-700">
                    Photo saved successfully.
                </p>
            )}

            <p className="text-xs text-muted-foreground">
                JPG, PNG or WebP, up to 5 MB. Wait for Photo Saved
                before leaving this page.
            </p>
        </div>
    );
}