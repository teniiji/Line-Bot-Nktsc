import { messagingApi } from "@line/bot-sdk";

const globalForLine = globalThis as unknown as {
  lineClient: messagingApi.MessagingApiClient | undefined;
  lineBlobClient: messagingApi.MessagingApiBlobClient | undefined;
};

export const lineClient =
  globalForLine.lineClient ??
  new messagingApi.MessagingApiClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
  });

export const lineBlobClient =
  globalForLine.lineBlobClient ??
  new messagingApi.MessagingApiBlobClient({
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
  });

if (process.env.NODE_ENV !== "production") {
  globalForLine.lineClient = lineClient;
  globalForLine.lineBlobClient = lineBlobClient;
}
