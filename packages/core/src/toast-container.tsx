"use client";

// @ts-ignore -- react is resolved via the consuming app's node_modules
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { useEffect } from "react";
import { useToastStore } from "./toast-store";
import type { ToastItem } from "./toast-store";

// ---------------------------------------------------------------------------
// Inline Toast atom — no dependency on theme-perfecto or lucide-react.
// Uses only inline styles so it works in any app (storefront, seller-portal).
// ---------------------------------------------------------------------------

const VARIANT_COLORS: Record<string, { bg: string; border: string; color: string; icon: string }> = {
  success: { bg: "#f0fdf4", border: "#86efac", color: "#166534", icon: "✓" },
  error:   { bg: "#fef2f2", border: "#fca5a5", color: "#991b1b", icon: "✕" },
  info:    { bg: "#f8fafc", border: "#e2e8f0", color: "#1e293b", icon: "ℹ" },
};

function ToastItem({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  const v = VARIANT_COLORS[toast.variant] ?? VARIANT_COLORS.info;

  useEffect(() => {
    if (!toast.autoDismissMs) return;
    const t = setTimeout(onClose, toast.autoDismissMs);
    return () => clearTimeout(t);
  }, [toast.autoDismissMs, onClose]);

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        padding: "12px 16px",
        borderRadius: "12px",
        border: `1px solid ${v.border}`,
        background: v.bg,
        color: v.color,
        boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
        fontSize: "14px",
        lineHeight: "1.5",
        width: "100%",
        maxWidth: "360px",
        boxSizing: "border-box",
      }}
    >
      <span style={{ fontWeight: 700, flexShrink: 0, marginTop: "1px" }}>{v.icon}</span>
      <p style={{ flex: 1, margin: 0 }}>{toast.message}</p>
      <button
        aria-label="Dismiss"
        onClick={onClose}
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "inherit",
          opacity: 0.6,
          fontSize: "16px",
          padding: 0,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismissToast = useToastStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: "1.5rem",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 60,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        width: "calc(100% - 2rem)",
        maxWidth: "360px",
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => (
        <div key={toast.id} style={{ pointerEvents: "auto" }}>
          <ToastItem toast={toast} onClose={() => dismissToast(toast.id)} />
        </div>
      ))}
    </div>
  );
}
