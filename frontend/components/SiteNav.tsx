"use client";

import { APP_NAME } from "@/lib/brand";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";
import { useAuth } from "@/lib/useAuth";

/** Site header. Each destination is linked once: the landing page already carries the two main
 *  actions in its hero, so there the header shows only the brand; on every other page it offers
 *  the election list and the create action (hidden on the create page itself). */
export default function SiteNav() {
  const pathname = usePathname() || "/";
  const onHome = pathname === "/";
  const onCreate = pathname === "/elections/create";
  const onList = pathname === "/elections";
  const onVote = /^\/elections\/[^/]+\/vote(\/|$)/.test(pathname);
  const { user, signOut } = useAuth();

  return (
    <header className="site-header">
      <nav className="site-header-inner" aria-label="Main">
        <Link href="/" className="site-brand">
          <span className="brand-mark" aria-hidden="true" />
          {APP_NAME}
        </Link>
        {onHome && !user && (
          <Link href="/login" className="btn btn-sm">
            Sign in
          </Link>
        )}
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
            {user ? (
              <>
                <Link href="/dashboard" className="site-nav-link">
                  My elections
                </Link>
                {user.role === "owner" && (
                  <Link href="/accounts" className="site-nav-link">
                    Accounts
                  </Link>
                )}
                {!onCreate && !onVote && (
                  <Link href="/elections/create" className="btn primary btn-sm">
                    Create election
                  </Link>
                )}
                <button type="button" className="btn btn-sm" onClick={signOut}>
                  Sign out
                </button>
              </>
            ) : (
              <Link href="/login" className="btn primary btn-sm">
                Sign in
              </Link>
            )}
          </>
        )}
        <ThemeToggle />
      </nav>
    </header>
  );
}
