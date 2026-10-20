import { ApiError } from "./config";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Sends one invite through Resend's HTTP API (no extra packages needed). */
export async function sendInviteEmail(to: string, electionTitle: string, link: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new ApiError("Email sending is not set up on this server.", 503);

  const title = escapeHtml(electionTitle);
  const text =
    `You're invited to vote in "${electionTitle}".\n\n` +
    `Open this link to vote. It is personal to you and works once:\n${link}\n\n` +
    `You don't need a crypto wallet or any coins. Please don't forward this email.`;
  const html =
    `<p>You're invited to vote in <strong>${title}</strong>.</p>` +
    `<p><a href="${escapeHtml(link)}">Open your voting link</a></p>` +
    `<p style="color:#666;font-size:13px">It is personal to you and works once. You don't need a crypto wallet or any coins. Please don't forward this email.</p>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: `Your voting link: ${electionTitle}`, text, html }),
  });
  if (!res.ok) {
  const errorBody = await res.text();

  console.error("RESEND ERROR:", {
    status: res.status,
    statusText: res.statusText,
    body: errorBody,
  });

  throw new ApiError(
    `Resend error ${res.status}: ${errorBody}`,
    502
  );
}
}
