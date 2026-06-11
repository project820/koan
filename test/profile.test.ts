import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  defaultProfile,
  getProfilePath,
  loadProfile,
  resetProfile,
  saveProfile,
  updateProfile
} from "../src/core/profile.js";

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

  it("merges partial updates over the existing saved profile", async () => {
    const home = await mkdtemp(join(tmpdir(), "koan-home-"));
    try {
      await saveProfile(
        home,
        defaultProfile({
          developmentUnderstanding: "expert",
          language: "en",
          domainBackground: "finance"
        })
      );

      const updated = await updateProfile(home, { language: "ko" });

      expect(updated.language).toBe("ko");
      expect(updated.developmentUnderstanding).toBe("expert");
      expect(updated.domainBackground).toBe("finance");
      expect(await loadProfile(home)).toEqual(updated);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("merges over defaults only when no profile exists", async () => {
    const home = await mkdtemp(join(tmpdir(), "koan-home-"));
    try {
      const updated = await updateProfile(home, { explanationStyle: "short" });

      expect(updated.explanationStyle).toBe("short");
      expect(updated.language).toBe("ko");
      expect(updated.learningMode).toBe("approval_required");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("rejects invalid partial updates without touching the saved profile", async () => {
    const home = await mkdtemp(join(tmpdir(), "koan-home-"));
    try {
      await saveProfile(home, defaultProfile({ language: "en" }));

      await expect(updateProfile(home, { language: "fr" as never })).rejects.toThrow();

      expect((await loadProfile(home))?.language).toBe("en");
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});
