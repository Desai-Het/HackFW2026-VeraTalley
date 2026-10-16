import { APP_NAME } from "../brand";
import { ApiError } from "./config";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Sends one invite through Resend's HTTP API (no extra packages needed). */
export async function sendInviteEmail(to: string, rawTitle: string, link: string): Promise<void> {
  // The title is chosen by whoever created the election: keep it to one short line of plain text.
  const electionTitle = rawTitle.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 120);
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new ApiError("Email sending is not set up on this server.", 503);

  const title = escapeHtml(electionTitle);
  const text =
    `You're invited to vote in "${electionTitle}".\n\n` +
    `Open this link to vote. It is personal to you and works once:\n${link}\n\n` +
    `You don't need a crypto wallet or any coins. Please don't forward this email.\n\nSent by ${APP_NAME}.`;
  const html =
    `<p>You're invited to vote in <strong>${title}</strong>.</p>` +
    `<p><a href="${escapeHtml(link)}">Open your voting link</a></p>` +
    `<p style="color:#666;font-size:13px">It is personal to you and works once. You don't need a crypto wallet or any coins. Please don't forward this email.</p>` +
    `<p style="color:#999;font-size:12px">Sent by ${escapeHtml(APP_NAME)}.</p>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: `Your voting link: ${electionTitle}`, text, html }),
  });
  if (!res.ok) throw new ApiError("The email service refused this message.", 502);
}
