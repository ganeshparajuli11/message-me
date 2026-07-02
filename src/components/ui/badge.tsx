import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

type Variant = "default" | "accent" | "muted" | "danger" | "outline";

const variants: Record<Variant, string> = {
  default: "bg-moss/15 text-moss dark:bg-moss/30 dark:text-paper",
  accent: "bg-clay text-paper",
  muted: "bg-surface-2 text-ash",
  danger: "bg-red-800/15 text-red-800 dark:bg-red-400/20 dark:text-red-300",
  outline: "border border-line text-fg",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
