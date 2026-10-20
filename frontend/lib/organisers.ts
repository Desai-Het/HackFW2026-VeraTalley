import { getAddress, isAddress } from "ethers";

/** The wallets allowed to run elections through this website's server.
 *
 *  The blockchain itself is open: anybody can create an election on the factory. But this
 *  website's server pays gas for voters and sends emails, and that must not be free for
 *  strangers. So the server only works for elections created by the wallets listed in
 *  NEXT_PUBLIC_ORGANISER_WALLETS (comma separated). The list is public information (wallet
 *  addresses are public anyway), which lets the election lists also hide strangers' elections.
 *
 *  Left empty, the server accepts everybody ONLY on a local test chain. */
export function parseOrganisers(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(/[\s,;]+/)
    .filter((a) => isAddress(a))
    .map((a) => getAddress(a).toLowerCase());
}

/** For browser code. The literal property name lets Next.js put the value in the page. */
export function clientOrganisers(): string[] {
  return parseOrganisers(process.env.NEXT_PUBLIC_ORGANISER_WALLETS);
}

export function isClientOrganiser(creator: string): boolean {
  const list = clientOrganisers();
  return list.length === 0 || list.includes(creator.toLowerCase());
}
