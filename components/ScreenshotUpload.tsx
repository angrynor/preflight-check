"use client";

import { useCallback, useRef, useState } from "react";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

interface Props {
  value: { name: string; base64: string } | null;
  onChange: (v: { name: string; base64: string } | null) => void;
  disabled?: boolean;
}

export function ScreenshotUpload({ value, onChange, disabled }: Props) {
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = useCallback(
    async (file: File | null | undefined) => {
      setError(null);
      if (!file) return;
      if (!ACCEPTED.includes(file.type)) {
        setError(`Unsupported image type: ${file.type || "unknown"}`);
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(`Screenshot is ${(file.size / 1_048_576).toFixed(1)}MB; 5MB max.`);
        return;
      }
      const base64 = await fileToBase64(file);
      onChange({ name: file.name, base64 });
    },
    [onChange]
  );

  return (
    <div>
      <label className="field-label">TradingView screenshot (optional)</label>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (disabled) return;
          const file = e.dataTransfer.files?.[0];
          handleFile(file);
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload TradingView screenshot"
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={[
          "rounded-md border border-dashed px-4 py-5 text-sm text-muted text-center cursor-pointer",
          "transition-colors",
          drag ? "border-accent bg-accent/5" : "border-white/15 hover:border-white/30",
          disabled ? "opacity-50 cursor-not-allowed" : ""
        ].join(" ")}
      >
        {value ? (
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-xs truncate text-primary">{value.name}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
              className="text-xs text-muted hover:text-bear underline-offset-4 hover:underline"
              disabled={disabled}
            >
              remove
            </button>
          </div>
        ) : (
          <span>
            Drag a chart image here, or <span className="text-accent">click to browse</span>{" "}
            <span className="text-muted/60">(PNG, JPG, WEBP — max 5MB)</span>
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(",")}
          className="hidden"
          data-testid="screenshot-input"
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          disabled={disabled}
        />
      </div>
      {error && <p className="mt-2 text-xs text-bear">{error}</p>}
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}
