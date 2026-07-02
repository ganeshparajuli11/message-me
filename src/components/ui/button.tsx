"use client";

import { cn } from "@/lib/utils";
import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * shadcn-style Button, hand-copied into the codebase (the shadcn CLI registry
 * was unreachable at build time; same copy-into-repo model, no black-box dep).
 */
type Variant = "default" | "accent" | "ghost" | "outline" | "destructive";
type Size = "default" | "sm" | "icon";

const variants: Record<Variant, string> = {
  default:
    "bg-moss text-paper hover:bg-moss/90 focus-visible:ring-moss/40 shadow-sm",
  accent:
    "bg-clay text-paper hover:bg-clay/90 focus-visible:ring-clay/40 shadow-sm",
  ghost: "hover:bg-surface-2 text-fg",
  outline: "border border-line bg-transparent hover:bg-surface-2 text-fg",
  destructive:
    "bg-red-800/90 text-paper hover:bg-red-800 focus-visible:ring-red-800/40",
};

const sizes: Record<Size, string> = {
  default: "h-10 px-4 py-2 text-sm",
  sm: "h-8 px-3 text-xs",
  icon: "h-10 w-10",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
