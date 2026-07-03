import type { Metadata } from "next";
// Self-hosted fonts (no Google Fonts dependency at build or runtime — keeps
// the product fully self-contained for the buyer's VPS).
import "@fontsource-variable/fraunces";
import "@fontsource-variable/public-sans";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { ConvexClientProvider } from "@/components/convex-client-provider";

export const metadata: Metadata = {
  title: "Inkwell — private chat",
  description: "A private, one-to-one chat that feels like a handwritten note.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="relative min-h-dvh">
        <ClerkProvider
          appearance={{
            // Ink & Paper theming for Clerk's hosted components (revamp
            // Section 3) — visual only, no auth/session logic touched.
            variables: {
              colorPrimary: "#4a5d45", // moss
              colorForeground: "#2b2621", // ink
              colorBackground: "#f7f3ec", // paper
              colorMutedForeground: "#9c9488", // ash
              colorMuted: "#efe9de",
              colorInput: "#efe9de",
              colorInputForeground: "#2b2621",
              colorBorder: "#ddd5c6",
              colorDanger: "#c77b58", // clay
              fontFamily:
                '"Public Sans Variable", system-ui, -apple-system, sans-serif',
              borderRadius: "0.75rem",
            },
          }}
        >
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
