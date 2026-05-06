import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "../components/ThemeProvider";
import { Toaster } from "react-hot-toast";

export const metadata: Metadata = {
  title: "Enterprise ERP - 智能制造管理系统",
  description:
    "面向制造业的企业资源规划系统，支持多公司、多仓库、生产管理、财务管理",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning className="antialiased">
        <ThemeProvider>{children}</ThemeProvider>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
