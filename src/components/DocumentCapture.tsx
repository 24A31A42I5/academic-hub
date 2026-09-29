import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, RotateCcw, Check, Lightbulb, AlertTriangle, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { analyzeImageQuality, type ImageQualityResult } from '@/lib/imageQuality';

interface DocumentCaptureProps {
  pageNumber?: number;
  onCapture: (file: File, quality: ImageQualityResult) => void;
  disabled?: boolean;
}

type Captured = { file: File; url: string; quality: ImageQualityResult };

/**
 * Inline launcher + full-screen camera overlay.
 * The video uses object-contain so the student sees exactly the full frame
 * that will be captured (no crop, no stretch).
 */
export function DocumentCapture({ pageNumber, onCapture, disabled }: DocumentCaptureProps) {
  const [open, setOpen] = useState(false);
  const [lastOk, setLastOk] = useState(false);

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setLastOk(false); setOpen(true); }}
        className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 px-4 py-8 text-center transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50 sm:py-10"
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Camera className="h-7 w-7" />
        </span>
        <span className="text-base font-semibold">Open camera — page {pageNumber ?? 1}</span>
        <span className="max-w-xs text-sm text-muted-foreground">
          Place the whole page on a flat surface in good light.
        </span>
      </button>
      {lastOk && (
        <p className="flex items-center gap-1.5 text-sm text-student">
          <Check className="h-4 w-4" /> Page {Math.max(1, (pageNumber ?? 2) - 1)} captured and passed the quality check.
        </p>
      )}
      {open && (
        <CameraOverlay
          pageNumber={pageNumber}
          onClose={() => setOpen(false)}
          onConfirm={(c) => {
            onCapture(c.file, c.quality);
            setLastOk(true);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

function CameraOverlay({
  pageNumber, onClose, onConfirm,
}: { pageNumber?: number; onClose: () => void; onConfirm: (c: Captured) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [captured, setCaptured] = useState<Captured | null>(null);

  // Lock page scroll while open.
  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, []);

  // Start / stop camera.
  useEffect(() => {
    let active = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This device has no supported camera. Use a phone with a camera to capture the page.');
      setFatal(true);
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((stream) => {
        if (!active || !videoRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
      })
      .catch(() => {
        setError('Camera access was denied or unavailable. Allow camera access in your browser settings, then try again.');
        setFatal(true);
      });
    return () => { active = false; streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => () => { if (captured) URL.revokeObjectURL(captured.url); }, [captured]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    setError(null);
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((v) => (v ? resolve(v) : reject(new Error('Capture failed.'))), 'image/jpeg', 0.95));
      const quality = await analyzeImageQuality(blob);
      if (!quality.ok) { setError(quality.failures.map((f) => f.message).join(' ')); return; }
      const file = new File([blob], `camera-page-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setCaptured({ file, url: URL.createObjectURL(file), quality });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not capture this page.');
    } finally {
      setBusy(false);
    }
  }, []);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Camera"
      className="fixed inset-0 z-[100] flex h-[100dvh] w-screen flex-col bg-camera text-camera-foreground overscroll-none touch-none"
    >
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close camera"
          className="h-11 w-11 rounded-full bg-camera-foreground/15 text-camera-foreground hover:bg-camera-foreground/25 hover:text-camera-foreground"
        >
          <X className="h-6 w-6" />
        </Button>
        <span className="rounded-full bg-camera-foreground/15 px-3 py-1.5 text-sm font-medium">
          {captured ? 'Review' : `Page ${pageNumber ?? 1}`}
        </span>
        <span className="w-11" />
      </div>

      {/* Viewfinder */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedData={() => setReady(true)}
          className={`h-full w-full object-contain ${captured ? 'hidden' : ''}`}
        />
        {captured && (
          <img src={captured.url} alt="Captured page preview" className="h-full w-full object-contain" />
        )}

        {!captured && ready && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            {/* A4-shaped guide */}
            <div className="relative aspect-[1/1.414] max-h-full w-auto h-full max-w-full rounded-lg border-2 border-camera-foreground/80 shadow-[0_0_0_9999px_hsl(var(--camera)/0.35)]">
              {['left-0 top-0 border-l-4 border-t-4 rounded-tl-lg', 'right-0 top-0 border-r-4 border-t-4 rounded-tr-lg', 'left-0 bottom-0 border-l-4 border-b-4 rounded-bl-lg', 'right-0 bottom-0 border-r-4 border-b-4 rounded-br-lg'].map((c) => (
                <span key={c} className={`absolute h-8 w-8 border-student ${c}`} />
              ))}
            </div>
          </div>
        )}

        {!ready && !fatal && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-camera-foreground/80">
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="text-sm">Starting camera…</span>
          </div>
        )}

        {error && (
          <div className="absolute inset-x-3 top-3">
            <Alert variant="destructive" className="bg-background text-foreground">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{fatal ? 'Camera unavailable' : 'Please capture again'}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">
        {!captured && !fatal && (
          <p className="mb-3 flex items-center justify-center gap-1.5 text-center text-xs text-camera-foreground/75">
            <Lightbulb className="h-4 w-4 shrink-0 text-warning" /> Even light, no glare — keep all four edges inside the frame.
          </p>
        )}
        {captured ? (
          <div className="mx-auto flex max-w-md gap-3">
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-14 flex-1 border-camera-foreground/40 bg-transparent text-base text-camera-foreground hover:bg-camera-foreground/10 hover:text-camera-foreground"
              onClick={() => { setCaptured(null); setError(null); }}
            >
              <RotateCcw className="mr-2 h-5 w-5" /> Retake
            </Button>
            <Button type="button" size="lg" className="h-14 flex-1 bg-student text-base text-student-foreground hover:bg-student/90" onClick={() => onConfirm(captured)}>
              <Check className="mr-2 h-5 w-5" /> Use photo
            </Button>
          </div>
        ) : fatal ? (
          <Button type="button" size="lg" className="mx-auto flex h-14 w-full max-w-md text-base" onClick={onClose}>
            Go back
          </Button>
        ) : (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={capture}
              disabled={!ready || busy}
              aria-label="Capture page"
              className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-camera-foreground transition-transform active:scale-95 disabled:opacity-50"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-camera-foreground text-camera">
                {busy ? <Loader2 className="h-7 w-7 animate-spin" /> : <Camera className="h-7 w-7" />}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
