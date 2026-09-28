import { useEffect, useRef, useState } from 'react';
import { Camera, RotateCcw, Check, Lightbulb, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { analyzeImageQuality, type ImageQualityResult } from '@/lib/imageQuality';

interface DocumentCaptureProps { pageNumber?: number; onCapture: (file: File, quality: ImageQualityResult) => void; disabled?: boolean; }

export function DocumentCapture({ pageNumber, onCapture, disabled }: DocumentCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (!navigator.mediaDevices?.getUserMedia) { setError('This device has no supported camera. Use a phone with a camera to capture the page.'); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false })
      .then((stream) => { if (active && videoRef.current) { streamRef.current = stream; videoRef.current.srcObject = stream; } else stream.getTracks().forEach((track) => track.stop()); })
      .catch(() => setError('Camera access was denied or unavailable. Allow camera access in your browser settings, then try again.'));
    return () => { active = false; streamRef.current?.getTracks().forEach((track) => track.stop()); };
  }, []);

  const capture = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    setError(null);
    setBusy(true);
    try {
      const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Capture failed.')), 'image/jpeg', 0.95));
      const quality = await analyzeImageQuality(blob);
      if (!quality.ok) { setError(quality.failures.map((failure) => failure.message).join(' ')); return; }
      const file = new File([blob], `camera-page-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setPreview(URL.createObjectURL(file)); onCapture(file, quality);
    } catch (captureError) { setError(captureError instanceof Error ? captureError.message : 'Could not capture this page.'); }
    finally { setBusy(false); }
  };

  return <div className="space-y-3">
    {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Camera capture unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-black"><video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" /><div className="pointer-events-none absolute inset-[8%] rounded border-2 border-white/80" /><div className="absolute left-3 top-3 rounded bg-black/60 px-2 py-1 text-xs text-white">Page {pageNumber ?? 1}</div></div>
    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Lightbulb className="h-4 w-4 text-warning" />Use even light, avoid glare, and keep all four page edges inside the frame.</div>
    {preview && <img src={preview} alt="Captured page preview" className="max-h-48 w-full rounded object-contain bg-muted" />}
    <div className="flex gap-2"><Button type="button" onClick={capture} disabled={disabled || busy}><Camera className="mr-2 h-4 w-4" />Capture page</Button>{preview && <Button type="button" variant="outline" onClick={() => { setPreview(null); setError(null); }}><RotateCcw className="mr-2 h-4 w-4" />Retake</Button>}{preview && <span className="inline-flex items-center text-sm text-student"><Check className="mr-1 h-4 w-4" />Quality passed</span>}</div>
  </div>;
}