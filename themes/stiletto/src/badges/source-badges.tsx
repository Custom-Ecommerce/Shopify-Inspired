"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Source = "dynamic" | "static" | "partial";
interface Chip {
  key: number;
  source: Source;
  note: string;
  left: number;
  top: number;
}

const COLORS: Record<Source, string> = { dynamic: "#15803d", static: "#b45309", partial: "#1d4ed8" };

/** Badges are a development aid. On by default outside production, or with NEXT_PUBLIC_THEME_DATA_BADGES=1; ?badges=0|1 overrides. */
function isEnabled(): boolean {
  const query = new URLSearchParams(window.location.search).get("badges");
  if (query === "1") return true;
  if (query === "0") return false;
  return process.env.NEXT_PUBLIC_THEME_DATA_BADGES === "1" || process.env.NODE_ENV !== "production";
}

/**
 * Chips for every [data-source] element, drawn in one absolutely positioned overlay on <body>. Elements are only read,
 * never wrapped or restyled, so the page layout is identical with badges on or off. Client-only: nothing in the server HTML.
 */
export function SourceBadges({ mode }: { mode: "demo" | "live" }) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [chips, setChips] = useState<Chip[]>([]);

  useEffect(() => {
    if (!isEnabled()) return;
    const el = document.createElement("div");
    el.setAttribute("data-source-badges", "");
    el.style.cssText = "position:absolute;top:0;left:0;width:100%;max-width:100vw;height:0;overflow-x:clip;pointer-events:none;z-index:2147483647;";
    document.body.appendChild(el);
    setContainer(el);

    let frame = 0;
    const measure = () => {
      frame = 0;
      const next: Chip[] = [];
      document.querySelectorAll<HTMLElement>("[data-source]").forEach((node, key) => {
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        const source = (node.getAttribute("data-source") ?? "static") as Source;
        next.push({ key, source, note: node.getAttribute("data-source-note") ?? "", left: Math.max(0, Math.min(rect.left + window.scrollX, document.documentElement.clientWidth - 110)), top: rect.top + window.scrollY });
      });
      setChips(next);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    schedule();
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-source", "class", "style"] });
    const resize = new ResizeObserver(schedule);
    resize.observe(document.body);
    window.addEventListener("resize", schedule);
    return () => {
      mutations.disconnect();
      resize.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
      el.remove();
      setContainer(null);
    };
  }, []);

  if (!container) return null;
  return createPortal(
    chips.map((chip) => (
      <span
        key={chip.key}
        title={chip.note}
        style={{
          position: "absolute",
          left: chip.left,
          top: chip.top,
          padding: "3px 6px",
          font: "700 10px/1 ui-monospace, monospace",
          letterSpacing: "0.04em",
          color: "#fff",
          background: COLORS[chip.source],
          borderRadius: 3,
          opacity: 0.92,
          whiteSpace: "nowrap",
        }}
      >
        {chip.source.toUpperCase()}
        {mode === "demo" ? " · DEMO DATA" : ""}
      </span>
    )),
    container,
  );
}
