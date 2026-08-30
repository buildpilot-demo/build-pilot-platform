import { expect, test } from "vitest";

import schema from "./schema.js";

const requiredTables = [
  "businesses",
  "leads",
  "projects",
  "voiceSessions",
  "transcripts",
  "requirements",
  "requirementVersions",
  "buildJobs",
  "deployments",
  "notifications",
  "activityEvents",
  "integrationEvents",
  "assets",
  "revisionRequests",
  "revisionAssets",
  "whatsappMessages",
  "workflowRuns",
  "stageAttempts",
  "webhookEvents",
  "callAttempts",
  "repositories",
  "generatedDocuments",
  "templateVersions",
  "siteTenants",
] as const;

function indexNames(tableName: keyof typeof schema.tables) {
  return schema.tables[tableName][" indexes"]().map(({ indexDescriptor }) => indexDescriptor);
}

test("defines every authoritative BuildPilot control-plane table", () => {
  expect(Object.keys(schema.tables)).toEqual(expect.arrayContaining([...requiredTables]));
});

test("defines the critical orchestration and audit indexes", () => {
  expect(indexNames("projects")).toEqual(expect.arrayContaining(["by_state", "by_workflow_run_state"]));
  expect(indexNames("activityEvents")).toContain("by_project_timestamp");
  expect(indexNames("stageAttempts")).toEqual(
    expect.arrayContaining(["by_idempotency_key", "by_status_lease_expiry"]),
  );
  expect(indexNames("webhookEvents")).toContain("by_provider_event_id");
  expect(indexNames("externalCallResponses")).toContain("by_scope_stage_cache_key");
  expect(indexNames("externalReplayRequests")).toContain("by_scope_stage_cache_status");
});
