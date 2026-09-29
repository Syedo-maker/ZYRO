/**
 * The integration suites run one realistic scenario per file (register stores, sell, refund...),
 * and make many named checks along the way. The scenario runs once, in `beforeAll`; every check
 * is its own Jest test, reported by name, so a report shows exactly which of the checks failed
 * and why, and a check that never ran (because the scenario stopped early) fails too.
 */
export interface CheckOutcome {
  ok: boolean;
  info: string;
}

export function createCheckRecorder() {
  const outcomes = new Map<string, CheckOutcome[]>();
  let scenarioError: unknown;

  /** Same signature the scenarios were written with. */
  function check(name: string, ok: boolean, info = ""): void {
    const list = outcomes.get(name) ?? [];
    list.push({ ok: !!ok, info });
    outcomes.set(name, list);
  }

  /** Runs the scenario, remembering (not throwing) a crash so each check can report it. */
  async function run(scenario: () => Promise<void>): Promise<void> {
    try {
      await scenario();
    } catch (err) {
      scenarioError = err;
    }
  }

  /** Declares one Jest test per expected check. A name that matches `/.../` is a pattern for a check whose name is built at run time. */
  function declare(names: (string | RegExp)[]): void {
    for (const name of names) {
      test(typeof name === "string" ? name : `${name.source} (every run)`, () => {
        const got =
          typeof name === "string" ? outcomes.get(name) : [...outcomes.entries()].filter(([n]) => name.test(n)).flatMap(([, v]) => v);
        if (!got || got.length === 0) {
          if (scenarioError) throw scenarioError;
          throw new Error("This check never ran: the scenario stopped before reaching it");
        }
        const failed = got.filter((o) => !o.ok);
        if (failed.length > 0) {
          throw new Error(`Check failed${failed[0].info ? `: ${failed[0].info}` : ""}${failed.length > 1 ? ` (failed ${failed.length} of ${got.length} times)` : ""}`);
        }
      });
    }
  }

  return { check, run, declare };
}

/** Puts back every environment variable a suite changed, so one file's settings never leak into the next. */
export function snapshotEnv(): () => void {
  const saved = { ...process.env };
  return () => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    for (const [key, value] of Object.entries(saved)) process.env[key] = value;
  };
}
