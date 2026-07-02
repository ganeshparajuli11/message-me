import { cn } from "@/lib/utils";

const PALETTE = ["bg-moss", "bg-clay", "bg-ash", "bg-ink dark:bg-surface-2"];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({
  username,
  online,
  className,
}: {
  username: string;
  online?: boolean;
  className?: string;
}) {
  const color = PALETTE[hashCode(username) % PALETTE.length];
  return (
    <div className={cn("relative shrink-0", className)}>
      <div
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-full font-display text-sm font-semibold text-paper",
          color,
        )}
      >
        {username.slice(0, 2).toUpperCase()}
      </div>
      {online !== undefined && (
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg",
            online ? "bg-moss" : "bg-ash/60",
          )}
          aria-label={online ? "online" : "offline"}
        />
      )}
    </div>
  );
}
