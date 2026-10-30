import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import type { Metadata } from "next";
import "./globals.css";
import SiteNav from "@/components/SiteNav";
import Backdrop from "@/components/Backdrop";
import TiltEffect from "@/components/TiltEffect";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "A verifiable election platform - vote and check the result for yourself, on-chain.",
};

// Runs before the body paints, so the chosen theme applies immediately instead of flashing dark
// (the default - see ThemeToggle.tsx) and then switching. Only ever reads what the viewer picked
// last time; it does not check the OS theme. Keep the storage key in sync with ThemeToggle.tsx.
const THEME_INIT_SCRIPT =
  '(function(){try{var t=localStorage.getItem("veratally-theme");' +
  'document.documentElement.dataset.theme=t==="light"?"light":"dark";}' +
  'catch(e){document.documentElement.dataset.theme="dark";}})();';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Backdrop />
        <TiltEffect />
        <SiteNav />
        {children}
        <footer className="site-footer">
          <div className="site-footer-inner">
            <p>{APP_NAME}. {APP_TAGLINE}</p>
            <p>Votes are public on the blockchain.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
