import { describe, expect, it } from "vitest";
import {
  PENDING_TRANSACTION_EXPIRY_MS,
  PENDING_TRANSACTION_RETENTION_MS,
} from "../lib/agent/state";

// Guards the invariant the "รายการค้าง" panel depends on: an unfinished
// transaction has to outlive the bot's own expiry, otherwise a row would be
// pruned before staff ever get a chance to see that a member sent a slip and
// never finished (which is the whole point of that panel).
describe("pending transaction lifetimes", () => {
  it("keeps rows for staff well past the point the bot stops resuming them", () => {
    expect(PENDING_TRANSACTION_RETENTION_MS).toBeGreaterThan(PENDING_TRANSACTION_EXPIRY_MS);
  });

  it("retains for days, not minutes — staff don't check the dashboard every hour", () => {
    const oneDay = 24 * 60 * 60 * 1000;
    expect(PENDING_TRANSACTION_RETENTION_MS).toBeGreaterThanOrEqual(oneDay);
  });
});
