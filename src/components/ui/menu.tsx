"use client";

import { cn } from "@/lib/utils";
import { MoreVertical } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Minimal dropdown menu (shadcn-style, hand-copied — no external dep).
 * Used for per-message actions (pin, delete, report…).
 */

const MenuContext = createContext<{ close: () => void }>({ close: () => {} });

export function Menu({
  trigger,
  children,
  align = "end",
  className,
}: {
  trigger?: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        aria-label="Message actions"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="rounded-md p-1 text-ash hover:bg-surface-2 hover:text-fg cursor-pointer"
      >
        {trigger ?? <MoreVertical className="h-4 w-4" />}
      </button>
      {open && (
        <MenuContext.Provider value={{ close: () => setOpen(false) }}>
          <div
            role="menu"
            className={cn(
              "absolute z-30 mt-1 min-w-44 overflow-hidden rounded-xl border border-line bg-bg py-1 shadow-lg",
              align === "end" ? "right-0" : "left-0",
            )}
          >
            {children}
          </div>
        </MenuContext.Provider>
      )}
    </div>
  );
}

export function MenuItem({
  onSelect,
  children,
  destructive = false,
}: {
  onSelect: () => void;
  children: ReactNode;
  destructive?: boolean;
}) {
  const { close } = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        close();
        onSelect();
      }}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface cursor-pointer",
        destructive ? "text-clay" : "text-fg",
      )}
    >
      {children}
    </button>
  );
}
