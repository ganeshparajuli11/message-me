"use client";

import { cn } from "@/lib/utils";
import { forwardRef, type InputHTMLAttributes } from "react";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-10 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-ash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-moss/40 disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
