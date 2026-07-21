import { describe, expect, it } from "vitest";

import { createNewProject } from "../src/document-model/schema";
import {
  autosaveFileName,
  createAutosaveEnvelope,
  createProjectKey,
  parseAutosaveEnvelope,
  projectContentHash,
  recoveryCandidateFromAutosave,
  recoveryFilesToPrune,
  serializeAutosaveEnvelope,
} from "../src/project/recovery";
import type { RecoveryFileInfo } from "../src/project/fileAccess";

describe("project recovery metadata", () => {
  it("serializes and validates autosave envelopes without using document text in file names", () => {
    const project = {
      ...createNewProject(new Date("2026-07-19T00:00:00.000Z")),
      metadata: { title: "日本語の秘密タイトル" },
      editorContent: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "本文" }] }],
      },
    };
    const projectKey = createProjectKey("/tmp/project.json", "seed");
    const envelope = createAutosaveEnvelope({
      project,
      projectKey,
      projectPath: "/tmp/project.json",
      revision: 3,
      lastExplicitSaveAt: "2026-07-19T00:00:00.000Z",
      now: new Date("2026-07-19T00:01:00.000Z"),
    });
    const parsed = parseAutosaveEnvelope(serializeAutosaveEnvelope(envelope));

    expect(parsed.contentHash).toBe(projectContentHash(project));
    expect(parsed.revision).toBe(3);
    expect(autosaveFileName(projectKey)).not.toContain("日本語");
    expect(autosaveFileName(projectKey)).not.toContain("本文");
  });

  it("classifies newer, same, and corrupted recovery candidates", () => {
    const current = createNewProject(new Date("2026-07-19T00:00:00.000Z"));
    const newer = { ...current, updatedAt: "2026-07-19T00:02:00.000Z" };
    const file: RecoveryFileInfo = {
      name: "autosave-test.json",
      path: "/tmp/autosave-test.json",
      modified_millis: Date.parse("2026-07-19T00:02:00.000Z"),
      byte_size: 100,
    };
    const envelope = createAutosaveEnvelope({
      project: newer,
      projectKey: "test",
      projectPath: null,
      revision: 1,
      lastExplicitSaveAt: null,
      now: new Date("2026-07-19T00:02:00.000Z"),
    });

    const candidate = recoveryCandidateFromAutosave(
      file,
      serializeAutosaveEnvelope(envelope),
      current,
    );
    const same = recoveryCandidateFromAutosave(
      file,
      serializeAutosaveEnvelope({
        ...envelope,
        project: current,
        contentHash: projectContentHash(current),
      }),
      current,
    );
    const broken = recoveryCandidateFromAutosave(file, "{", current);

    expect(candidate.valid).toBe(true);
    expect(candidate.newerThanCurrent).toBe(true);
    expect(same.sameAsCurrent).toBe(true);
    expect(broken.valid).toBe(false);
  });

  it("rejects recovery projects from unsupported future format versions", () => {
    const current = createNewProject(new Date("2026-07-19T00:00:00.000Z"));
    const futureProject = { ...current, formatVersion: 999 };
    const file: RecoveryFileInfo = {
      name: "autosave-future.json",
      path: "/tmp/autosave-future.json",
      modified_millis: Date.parse("2026-07-19T00:02:00.000Z"),
      byte_size: 100,
    };
    const envelope = {
      envelopeVersion: 1,
      kind: "autosave",
      projectKey: "test",
      sourcePathHash: null,
      sourcePath: null,
      autosavedAt: "2026-07-19T00:02:00.000Z",
      lastExplicitSaveAt: null,
      projectUpdatedAt: current.updatedAt,
      revision: 1,
      contentHash: "future",
      appVersion: "99.0.0",
      project: futureProject,
    };

    const candidate = recoveryCandidateFromAutosave(file, JSON.stringify(envelope), current);

    expect(candidate.valid).toBe(false);
    expect(candidate.project).toBeUndefined();
  });

  it("selects expired, per-project overflow, and total-size overflow recovery files for pruning", () => {
    const now = new Date("2026-07-19T00:00:00.000Z");
    const files: RecoveryFileInfo[] = [
      {
        name: "autosave-old.json",
        path: "/tmp/autosave-old.json",
        modified_millis: Date.parse("2026-06-01T00:00:00.000Z"),
        byte_size: 1,
      },
      ...Array.from({ length: 6 }).map((_, index) => ({
        name: `autosave-same-${index}.json`,
        path: `/tmp/autosave-same-${index}.json`,
        modified_millis: Date.parse(`2026-07-19T00:0${index}:00.000Z`),
        byte_size: 25 * 1024 * 1024,
      })),
    ];

    const prune = recoveryFilesToPrune(files, now).map((file) => file.name);

    expect(prune).toContain("autosave-old.json");
    expect(prune.length).toBeGreaterThan(1);
  });
});
