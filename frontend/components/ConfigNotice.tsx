/** Shown instead of a page's content when the app has no election factory address yet. */
export default function ConfigNotice() {
  return (
    <div className="status-banner error">
      This app isn&apos;t pointed at an election factory yet. Set NEXT_PUBLIC_ELECTION_FACTORY_ADDRESS in
      frontend/.env.local, then restart the app.
    </div>
  );
}
