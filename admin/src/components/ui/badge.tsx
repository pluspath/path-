import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "success" | "warning" | "danger" | "muted";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variant === "default" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
        variant === "success" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
        variant === "warning" && "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
        variant === "danger" && "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
        variant === "muted" && "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
        className
      )}
      {...props}
    />
  );
}
