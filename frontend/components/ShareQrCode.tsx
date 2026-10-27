"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

type Props = {
  /** Path to link to, e.g. "/elections/3". The absolute URL is built from the browser's own
   *  origin at mount time, since the app has no fixed public URL baked in at build time. */
  path: string;
  shareTitle: string;
  /** Pixel size of the QR image. Defaults to a compact size for the admin panel; the live-stats
   *  display passes a larger one, since that's meant to be scanned from across a room. */
  size?: number;
  alt?: string;
};

/** A QR code linking to `path`, plus a share control: the device's native share sheet when the
 *  browser supports it, falling back to copying the link (most desktop browsers don't support
 *  navigator.share). Both the URL and the share action need `window`/`navigator`, so they're
 *  resolved after mount rather than during render - the same pattern `useWallet` uses. */
export default function ShareQrCode({ path, shareTitle, size = 176, alt = "QR code for this page" }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(`${window.location.origin}${path}`);
  }, [path]);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    QRCode.toDataURL(url, { margin: 1, width: size })
      .then((d) => {
        if (!cancelled) setDataUrl(d);
      })
      .catch((err) => console.error("Failed to generate QR code", err));
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  async function share() {
    if (!url) return;
    setCopied(false);
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: shareTitle, url });
      } catch (err: any) {
        // AbortError just means the admin closed the share sheet without picking anything.
        if (err?.name !== "AbortError") console.error("Share failed", err);
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch (err) {
      console.error("Failed to copy link", err);
    }
  }

  return (
    <div className="qr-box">
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, not an optimizable asset
        <img src={dataUrl} alt={alt} width={size} height={size} />
      ) : (
        <p className="hint">Generating QR code...</p>
      )}
      {url && <p className="hint mono">{url}</p>}
      <button onClick={share} disabled={!url}>
        {copied ? "Link copied" : "Share"}
      </button>
    </div>
  );
}
