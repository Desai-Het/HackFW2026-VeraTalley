import Link from "next/link";
import NavWallet from "@/components/NavWallet";

/** Site-wide navigation. The home page (the single demo election from the env file) is left as
 *  it was; the other two links lead to the factory-based pages. */
export default function SiteNav() {
  return (
    <nav className="site-nav" aria-label="Main">
      <Link href="/" className="site-nav-brand">
        VeraTally
      </Link>
      <Link href="/elections">All elections</Link>
      <Link href="/elections/create">Create an election</Link>
      <NavWallet />
    </nav>
  );
}
