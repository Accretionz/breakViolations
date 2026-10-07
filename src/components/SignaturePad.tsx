import { useEffect, useRef, type PointerEvent } from "react";
import { signatureToMask } from "../waivers/signature";
import type { ImageMask } from "../waivers/simplePdf";

type Props = {
  label: string;
  onChange: (signature: ImageMask | null) => void;
};

/** Draw-to-sign box. Works with a mouse, a finger on a touchscreen, or a stylus. */
export default function SignaturePad({ label, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Match the canvas's pixel size to its on-screen size so strokes stay sharp.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
  }, []);

  const context = () => {
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineWidth = 2.5 * (window.devicePixelRatio || 1);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0d1f73";
    return ctx;
  };

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = e.currentTarget.width / rect.width;
    return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
  };

  const strokeTo = (p: { x: number; y: number }) => {
    const from = last.current ?? p;
    const ctx = context();
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(p.x + 0.01, p.y + 0.01);
    ctx.stroke();
    last.current = p;
  };

  const finish = () => {
    if (!last.current) return;
    last.current = null;
    const canvas = canvasRef.current!;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    onChange(signatureToMask(pixels.data, canvas.width, canvas.height));
  };

  const clear = () => {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    last.current = null;
    onChange(null);
  };

  return (
    <div className="signature-pad">
      <div className="signature-pad-header">
        <span>{label}</span>
        <button type="button" className="link-button" onClick={clear}>
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        aria-label={label}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          last.current = null;
          strokeTo(point(e));
        }}
        onPointerMove={(e) => {
          if (last.current) strokeTo(point(e));
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
    </div>
  );
}
