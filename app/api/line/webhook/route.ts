import { NextRequest, NextResponse } from "next/server";
import { validateSignature, webhook } from "@line/bot-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { put } from "@vercel/blob";
import { lineClient, lineBlobClient } from "@/lib/lineClient";
import { runFinanceAgent } from "@/lib/financeAgent";
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
};

async function buildUserContent(
  message: webhook.MessageContent,
  lineUserId: string
): Promise<UserContentResult> {
  if (message.type === "text") {
    return {
      content: (message as webhook.TextMessageContent).text,
      slipImageUrlPromise: Promise.resolve(null),
      slipImageHash: null,
    };
  }

  const image = message as webhook.ImageMessageContent;
  const stream = await lineBlobClient.getMessageContent(image.id);
  const buffer = await streamToBuffer(stream);
  // Deterministic identity for the exact image bytes — resending the same
  // photo (e.g. re-testing, or a member accidentally forwarding a slip
  // twice) always hashes identically, unlike the reference number the
  // vision model reads off it, which isn't guaranteed consistent between
  // two separate OCR passes over two separate uploads of the same slip.
  const slipImageHash = createHash("sha256").update(buffer).digest("hex");

  // Back up every image message to Blob storage regardless of what the
  // agent decides to do with it — a failed upload shouldn't block logging.
  // Deliberately not awaited here: the upload has no dependency on the
  // Claude vision call below, so kicking it off and handing back the
  // in-flight promise lets the two network calls run concurrently instead
  // of the vision call waiting for the upload to finish first. Skipped
  // entirely (not attempted-and-caught) when the token isn't configured,
  // so we don't throw a full stack trace on every image in that setup.
  const slipImageUrlPromise = process.env.BLOB_READ_WRITE_TOKEN
    ? put(`slips/${lineUserId}/${Date.now()}-${image.id}.jpg`, buffer, {
        access: "public",
        contentType: "image/jpeg",
      })
        .then((blob) => blob.url)
        .catch((err) => {
          console.error("[line/webhook] blob upload error:", err);
          return null;
        })
    : Promise.resolve(null);

  return {
    content: [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: buffer.toString("base64"),
        },
      },
      {
        type: "text",
        text: "นี่คือรูปที่ผู้ใช้ส่งมา ถ้าเป็นสลิปการโอนเงินให้อ่านยอดเงินและบันทึกเป็นรายการ",
      },
    ],
    slipImageUrlPromise,
    slipImageHash,
  };
}

async function handleEvent(event: webhook.Event): Promise<void> {
  if (
    event.type !== "message" ||
    (event.message.type !== "text" && event.message.type !== "image") ||
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

  const lineUserId = event.source.userId;

  let replyText: string;
  try {
    // Independent of building the message content — run concurrently
    // instead of adding its (usually skipped, but occasionally a real LINE
    // API call) latency in front of the agent call.
    const [{ content: userContent, slipImageUrlPromise, slipImageHash }] = await Promise.all([
      buildUserContent(event.message, lineUserId),
      ensureLineUser(lineUserId),
    ]);
    replyText = await runFinanceAgent(
      userContent,
      lineUserId,
      slipImageUrlPromise,
      slipImageHash
    );
  } catch (err) {
    console.error("[line/webhook] finance agent error:", err);
    replyText = "ขอโทษค่ะ เกิดข้อผิดพลาด ลองใหม่อีกครั้งนะคะ";
  }

  try {
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: "text", text: replyText }],
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
      handleEvent(event).catch((err) =>
        console.error("[line/webhook] unhandled event error:", err)
      )
    )
  );

  return NextResponse.json({ status: "ok" });
}
