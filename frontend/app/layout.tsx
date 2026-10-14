import type { Metadata } from "next";
import "./globals.css";
import SiteNav from "@/components/SiteNav";
import Backdrop from "@/components/Backdrop";
import TiltEffect from "@/components/TiltEffect";

export const metadata: Metadata = {
  title: "VeraTally",
  description: "A verifiable election platform - vote and check the result for yourself, on-chain.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Backdrop />
        <TiltEffect />
        <SiteNav />
        {children}
        <footer className="site-footer">
          <div className="site-footer-inner">
            <p>VeraTally. Elections you can recount yourself.</p>
            <p>Votes are public on the blockchain.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
