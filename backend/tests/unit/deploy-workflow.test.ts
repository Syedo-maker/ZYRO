/**
 * The deploy workflow's gate (.github/workflows/deploy.yml, audit 2026-11). It runs after CI with the
 * staging cloud identity, and workflow_run's `branches: [main]` filter matches only the head branch
 * name, which a fork's pull request chooses freely. So a CI-triggered release must also be a push to
 * this repository itself; a manual dispatch (write access already needed) is unchanged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const workflow = yaml.load(readFileSync(join(__dirname, "../../../.github/workflows/deploy.yml"), "utf8")) as {
  jobs: Record<string, { if?: string; needs?: string | string[] }>;
};
const gate = workflow.jobs.build.if ?? "";

describe("the deploy workflow gate", () => {
  it("a CI-triggered release must come from a push, not a pull request", () => {
    expect(gate).toContain("github.event.workflow_run.event == 'push'");
  });

  it("and from this repository, not a fork", () => {
    expect(gate).toContain("github.event.workflow_run.head_repository.full_name == github.repository");
  });

  it("and from main", () => {
    expect(gate).toContain("github.event.workflow_run.head_branch == 'main'");
  });

  it("every other job waits for the gated build job", () => {
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (name === "build") continue;
      const needs = Array.isArray(job.needs) ? job.needs : [job.needs];
      expect(needs.some((n) => n === "build" || (n && workflow.jobs[n]))).toBe(true);
    }
  });
});
