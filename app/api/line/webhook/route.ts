import { NextRequest, NextResponse } from "next/server";
import { validateSignature, webhook } from "@line/bot-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { put } from "@vercel/blob";
import { lineClient, lineBlobClient } from "@/lib/lineClient";
import { runFinanceAgent } from "@/lib/financeAgent";
import { PENDING_TRANSACTION_EXPIRY_MS } from "@/lib/agent/state";
import { ensureLineUser } from "@/lib/lineUsers";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

type UserContentResult = {
  content: Anthropic.MessageParam["content"];
  slipImageUrlPromise: Promise<string | null>;
  slipImageHash: string | null;
  slipIsPdf: boolean;
};

// Shared by both the image and PDF branches below — only the media type,
// blob pathname extension, and Anthropic content-block shape differ.
async function buildAttachmentContent(
  fileId: string,
  lineUserId: string,
  origin: string,
  isPdf: boolean
): Promise<UserContentResult> {
  const stream = await lineBlobClient.getMessageContent(fileId);
  const buffer = await streamToBuffer(stream);
  // Deterministic identity for the exact file bytes — resending the same
  // photo/PDF (e.g. re-testing, or a member accidentally forwarding a slip
  // twice) always hashes identically, unlike the reference number the
  // vision model reads off it, which isn't guaranteed consistent between
  // two separate OCR passes over two separate uploads of the same slip.
  const slipImageHash = createHash("sha256").update(buffer).digest("hex");

  // Back up every attachment to Blob storage regardless of what the agent
  // decides to do with it — a failed upload shouldn't block logging.
  // Deliberately not awaited here: the upload has no dependency on the
  // Claude call below, so kicking it off and handing back the in-flight
  // promise lets the two network calls run concurrently instead of the
  // model call waiting for the upload to finish first. Skipped entirely
  // (not attempted-and-caught) when the token isn't configured, so we
  // don't throw a full stack trace on every message in that setup.
  // Vercel Blob dashboards no longer offer public-access stores, only
  // "private" (auth-required-to-read) ones — upload with access: "private"
  // and hand back our own proxy URL (app/api/blob/[...path]/route.ts,
  // excluded from Basic Auth) instead of blob.url, since LINE can't send
  // credentials to fetch a private blob directly.
  const extension = isPdf ? "pdf" : "jpg";
  const mediaType = isPdf ? "application/pdf" : "image/jpeg";
  const pathname = `slips/${lineUserId}/${Date.now()}-${fileId}.${extension}`;
  const slipImageUrlPromise = process.env.BLOB_READ_WRITE_TOKEN
    ? put(pathname, buffer, {
        access: "private",
        contentType: mediaType,
      })
        .then(() => `${origin}/api/blob/${pathname}`)
        .catch((err) => {
          console.error("[line/webhook] blob upload error:", err);
          return null;
        })
    : Promise.resolve(null);

  const promptText = isPdf
    ? "นี่คือไฟล์ PDF ที่ผู้ใช้ส่งมา ถ้าเป็นสลิปการโอนเงินให้อ่านยอดเงินและบันทึกเป็นรายการ"
    : "นี่คือรูปที่ผู้ใช้ส่งมา ถ้าเป็นสลิปการโอนเงินให้อ่านยอดเงินและบันทึกเป็นรายการ";
  const content: Anthropic.MessageParam["content"] = isPdf
    ? [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: buffer.toString("base64"),
          },
        },
        { type: "text", text: promptText },
      ]
    : [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/jpeg",
            data: buffer.toString("base64"),
          },
        },
        { type: "text", text: promptText },
      ];

  return { content, slipImageUrlPromise, slipImageHash, slipIsPdf: isPdf };
}

async function buildUserContent(
  message: webhook.MessageContent,
  lineUserId: string,
  origin: string
): Promise<UserContentResult> {
  if (message.type === "text") {
    return {
      content: (message as webhook.TextMessageContent).text,
      slipImageUrlPromise: Promise.resolve(null),
      slipImageHash: null,
      slipIsPdf: false,
    };
  }

  if (message.type === "file") {
    const file = message as webhook.FileMessageContent;
    return buildAttachmentContent(file.id, lineUserId, origin, true);
  }

  const image = message as webhook.ImageMessageContent;
  return buildAttachmentContent(image.id, lineUserId, origin, false);
}

async function handleEvent(event: webhook.Event, origin: string): Promise<void> {
  if (
    event.type !== "message" ||
    (event.message.type !== "text" &&
      event.message.type !== "image" &&
      event.message.type !== "file") ||
    !event.replyToken ||
    event.source?.type !== "user" ||
    !event.source.userId
  ) {
    return;
  }

  // LINE retries webhook deliveries that don't get a timely 200 (e.g. a
  // slow slip-image request that runs close to maxDuration). Record the
  // event ID first so a retried delivery for the same event is a no-op
  // instead of re-running the agent and creating a duplicate expense.
  try {
    await prisma.processedLineEvent.create({
      data: { eventId: event.webhookEventId },
    });
  } catch (err) {
    // P2002 (unique constraint) means this event was already processed —
    // a genuine, expected duplicate delivery, nothing to log. Anything
    // else (e.g. the database being unreachable) is a real failure that
    // would otherwise silently drop the message with no reply and no log.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) {
      console.error("[line/webhook] dedupe check failed:", err);
    }
    return;
  }

  // These rows only guard against LINE's retry window (minutes), so they're
  // useless once a day old and would otherwise grow forever. Prune opportunistically
  // on ~1% of events (fire-and-forget, never blocks handling) instead of
  // needing a separate scheduled job.
  if (Math.random() < 0.01) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    prisma.processedLineEvent
      .deleteMany({ where: { createdAt: { lt: cutoff } } })
      .catch((err) => console.error("[line/webhook] processed-event prune failed:", err));
  }

  // In-flight member-number lookups hold a typed national ID, and
  // loadPendingLookup's lazy expiry only deletes an expired row when that
  // same member messages again — a lookup abandoned by someone who never
  // returns would otherwise keep their national ID stored indefinitely.
  // Prune every expired row on every event instead (fire-and-forget, never
  // blocks handling): the table only ever holds the handful of lookups
  // currently in progress, so this is a near-free delete.
  const lookupCutoff = new Date(Date.now() - PENDING_TRANSACTION_EXPIRY_MS);
  prisma.pendingMemberLookup
    .deleteMany({ where: { createdAt: { lt: lookupCutoff } } })
    .catch((err) => console.error("[line/webhook] pending-lookup prune failed:", err));

  const lineUserId = event.source.userId;

  // LINE's "file" message type covers any generic file upload (PDF, Word,
  // Excel, ...). Only PDFs are supported as slips/documents — anything else
  // gets a direct, friendly reply instead of being silently dropped or
  // burning a Claude call on a file type it can't read.
  if (event.message.type === "file") {
    const fileName = (event.message as webhook.FileMessageContent).fileName ?? "";
    if (!fileName.toLowerCase().endsWith(".pdf")) {
      try {
        await lineClient.replyMessage({
          replyToken: event.replyToken,
          messages: [
            {
              type: "text",
              text: "ขอโทษค่ะ ตอนนี้บอทรองรับเฉพาะไฟล์รูปภาพหรือ PDF เท่านั้นค่ะ ลองส่งเป็นรูปภาพหรือไฟล์ PDF แทนนะคะ",
            },
          ],
        });
      } catch (err) {
        console.error("[line/webhook] LINE reply error:", err);
      }
      return;
    }
  }

  let replyText: string;
  let quickReplies: string[] = [];
  try {
    // Independent of building the message content — run concurrently
    // instead of adding its (usually skipped, but occasionally a real LINE
    // API call) latency in front of the agent call.
    const [{ content: userContent, slipImageUrlPromise, slipImageHash, slipIsPdf }] =
      await Promise.all([
        buildUserContent(event.message, lineUserId, origin),
        ensureLineUser(lineUserId),
      ]);
    const result = await runFinanceAgent(
      userContent,
      lineUserId,
      slipImageUrlPromise,
      slipImageHash,
      slipIsPdf
    );
    replyText = result.text;
    quickReplies = result.quickReplies;
  } catch (err) {
    console.error("[line/webhook] finance agent error:", err);
    replyText = "ขอโทษค่ะ เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะคะ";
  }

  // Attach tappable buttons for pick-one prompts (category, loan type) so
  // the member selects instead of typing — the tapped value is exact, and
  // it's far easier for less tech-savvy users. LINE caps the button label
  // at 20 chars but the sent text at 300, so long category names still
  // send in full while showing a truncated label.
  const quickReply =
    quickReplies.length > 0
      ? {
          items: quickReplies.slice(0, 13).map((value) => ({
            type: "action" as const,
            action: {
              type: "message" as const,
              label: value.length > 20 ? value.slice(0, 20) : value,
              text: value,
            },
          })),
        }
      : undefined;

  try {
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text: replyText, ...(quickReply ? { quickReply } : {}) }],
    });
  } catch (err) {
    console.error("[line/webhook] LINE reply error:", err);
  }
}

export async function POST(request: NextRequest) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET ?? "";
  const signature = request.headers.get("x-line-signature") ?? "";
  const rawBody = await request.text();

  if (!channelSecret || !validateSignature(rawBody, channelSecret, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: webhook.CallbackRequest;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const events = body.events ?? [];
  const origin = request.nextUrl.origin;

  // Opt-in helper for reading off a LINE user/group ID (e.g. when setting
  // up LINE_FORWARD_LOAN_ID / LINE_FORWARD_GENERAL_ID for a staff member):
  // set LOG_EVENT_SOURCES=1, have that person message the bot, read the id
  // from the logs, then unset it. Off by default so member user IDs aren't
  // logged in normal operation.
  if (process.env.LOG_EVENT_SOURCES === "1") {
    console.log("[line/webhook] event sources:", JSON.stringify(events.map((e) => e.source)));
  }

  // Process events but never let a single failure block the 200 response —
  // LINE retries the whole webhook delivery on a non-2xx, which would
  // re-trigger already-handled messages.
  await Promise.all(
    events.map((event) =>
      handleEvent(event, origin).catch((err) =>
        console.error("[line/webhook] unhandled event error:", err)
      )
    )
  );

  return NextResponse.json({ status: "ok" });
}
