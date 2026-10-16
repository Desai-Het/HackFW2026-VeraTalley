"use client";

import { APP_NAME } from "@/lib/brand";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Site header. Each destination is linked once: the landing page already carries the two main
 *  actions in its hero, so there the header shows only the brand; on every other page it offers
 *  the election list and the create action (hidden on the create page itself). */
export default function SiteNav() {
  const pathname = usePathname() || "/";
  const onHome = pathname === "/";
  const onCreate = pathname === "/elections/create";
  const onList = pathname === "/elections";

  return (
    <header className="site-header">
      <nav className="site-header-inner" aria-label="Main">
        <Link href="/" className="site-brand">
          <span className="brand-mark" aria-hidden="true" />
          {APP_NAME}
        </Link>
        {!onHome && (
          <>
            {!onList && (
              <Link href="/elections" className="site-nav-link">
                Elections
              </Link>
            )}
            <Link href="/check" className="site-nav-link">
              Check a vote
            </Link>
            {!onCreate && (
              <Link href="/elections/create" className="btn primary btn-sm">
                Create election
              </Link>
            )}
          </>
        )}
      </nav>
    </header>
  );
}
