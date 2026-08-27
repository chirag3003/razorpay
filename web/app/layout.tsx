import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AuthHydrator } from "@/components/auth/auth-hydrator";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FreshCart — Groceries delivered to your door",
  description:
    "Order fresh fruits, vegetables, dairy, and everyday essentials online with fast delivery.",
};

// `resizes-content` shrinks the layout viewport when the on-screen keyboard
// opens, which keeps the chat composer above it on Android. iOS Safari ignores
// this and is handled by useKeyboardInset instead.
export const viewport: Viewport = {
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("h-full", "antialiased", geistSans.variable, geistMono.variable, "font-sans", inter.variable)}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          {/* Site chrome lives in app/(shop)/layout.tsx so /admin can opt out of it. */}
          <TooltipProvider delay={200}>{children}</TooltipProvider>
          <Toaster position="top-center" richColors />
          <AuthHydrator />
        </ThemeProvider>
      </body>
    </html>
  );
}
