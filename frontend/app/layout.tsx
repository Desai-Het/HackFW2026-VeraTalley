import type { Metadata } from "next";
import "./globals.css";
import SiteNav from "@/components/SiteNav";
import WalletProvider from "@/components/WalletProvider";

export const metadata: Metadata = {
  title: "VeraTally",
  description: "A verifiable election platform - vote and check the result for yourself, on-chain.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <SiteNav />
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}
