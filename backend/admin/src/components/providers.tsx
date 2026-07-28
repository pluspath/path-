"use client";

import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "./theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        {children}
        <Toaster
          richColors
          position="top-right"
          toastOptions={{
            className: "font-sans text-sm",
          }}
        />
      </AuthProvider>
    </ThemeProvider>
  );
}
