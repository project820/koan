import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { defaultProfile, getProfilePath, loadProfile, resetProfile, saveProfile } from "../src/core/profile.js";

describe("profile", () => {
  it("stores profiles outside project repositories", async () => {
    const home = await mkdtemp(join(tmpdir(), "koan-home-"));
    try {
      expect(getProfilePath(home)).toBe(join(home, ".koan/profile.json"));
      await saveProfile(home, defaultProfile({ language: "ko" }));
      const loaded = await loadProfile(home);
      expect(loaded?.language).toBe("ko");
      await resetProfile(home);
      expect(await loadProfile(home)).toBeNull();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
