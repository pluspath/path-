import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  variant?: "default" | "success" | "warning" | "danger" | "muted" | "info";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        variant === "default" &&
          "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200/70 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-blue-800",
        variant === "info" &&
          "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200/70 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-800",
        variant === "success" &&
          "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200/70 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800",
        variant === "warning" &&
          "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800",
        variant === "danger" &&
          "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200/70 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-800",
        variant === "muted" &&
          "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200/80 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
        className
      )}
      {...props}
    />
  );
}
