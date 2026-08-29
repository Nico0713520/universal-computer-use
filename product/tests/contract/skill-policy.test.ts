import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const skillUrl = new URL("../../skills/computer-use/SKILL.md", import.meta.url);

async function readSkill(): Promise<string> {
  return (await readFile(skillUrl, "utf8")).replace(/\r\n/g, "\n");
}

describe("canonical computer-use Skill policy", () => {
  it("has precise discovery metadata and stays compact", async () => {
    const skill = await readSkill();
    const lines = skill.split(/\r?\n/);

    expect(lines.length).toBeLessThan(180);
    expect(skill).toMatch(/^---\nname: computer-use\ndescription: .+\n---\n/);
    expect(skill).toContain("computer_observe");
    expect(skill).toContain("computer_act");
  });

  it("defines the eight non-negotiable loop decisions exactly once", async () => {
    const skill = await readSkill();

    expect(skill.match(/^## Control loop$/gm)).toHaveLength(1);
    expect(skill).toMatch(/first action[\s\S]*computer_observe/i);
    expect(skill).toMatch(/fresh state returned by `computer_act`[\s\S]*before[\s\S]*next action/i);
    expect(skill).toMatch(/only[\s\S]*newest `snapshot_id`/i);
    expect(skill).toMatch(/exactly one smallest useful action[\s\S]*each `computer_act`/i);
    expect(skill).toMatch(/never[\s\S]*blindly repeat[\s\S]*(failed|uncertain)/i);
    expect(skill).toMatch(/visible goal[\s\S]*satisfied[\s\S]*stop/i);
    expect(skill).toMatch(/report[\s\S]*(permission|runtime)[\s\S]*blocker/i);
    expect(skill).toMatch(/host's current vision model/i);
    expect(skill).toMatch(/never request[\s\S]*plugin model key/i);
  });

  it("prevents avoidable latency and screenshot-coordinate misses", async () => {
    const skill = await readSkill();

    expect(skill).toMatch(
      /new snapshot[\s\S]*next observation[\s\S]*do not call `computer_observe` again/i,
    );
    expect(skill).toMatch(/never insert a fixed post-action wait[\s\S]*fresh evidence/i);
    expect(skill).toMatch(/interior center[\s\S]*(edge|gap)/i);
    expect(skill).toMatch(/discover apps and windows before guessing coordinates/i);
    expect(skill).toMatch(/prefer `element_ref`/i);
    expect(skill).toMatch(/do not repeat unverifiable text input/i);
    expect(skill).toMatch(/complete text once/i);
    expect(skill).not.toMatch(/sleep 3/i);
    expect(skill).not.toContain("bring_to_front");
  });

  it("teaches the adaptive semantic-next-state loop and safe visual recovery", async () => {
    const skill = await readSkill();

    for (const phrase of [
      "next_observation",
      "semantic",
      "visual_recovery",
      "semantic snapshot",
      "do not call `computer_observe` again",
      "Never insert a fixed post-action wait",
    ]) {
      expect(skill).toContain(phrase);
    }
    expect(skill).toMatch(/Canvas|WebGL/);
    expect(skill).toMatch(/never.*repeat|Never blindly repeat/i);
    expect(skill).toMatch(/50\/100\/200\/400\/500/);
    expect(skill).toMatch(/explicit `wait\(ms\)`/i);
    expect(skill).toMatch(/no universal post-action wait/i);
  });

  it("documents all public actions and actionable recovery without expanding the protocol", async () => {
    const skill = await readSkill();

    for (const action of [
      "click",
      "double_click",
      "right_click",
      "move",
      "drag",
      "scroll",
      "type",
      "type_text",
      "keypress",
      "set_value",
      "invoke_menu",
      "launch_app",
      "wait",
    ]) {
      expect(skill).toContain(`\`${action}\``);
    }
    for (const recovery of [
      "runtime_missing",
      "runtime_unavailable",
      "permission_required",
      "stale_snapshot",
      "coordinate_out_of_bounds",
      "action_timeout",
      "action_refused",
      "action_failed",
      "capture_failed",
    ]) {
      expect(skill).toContain(`\`${recovery}\``);
    }

    for (const forbidden of [
      "computer_verify",
      "element_token",
      "actions[]",
      "bypass host policy",
    ]) {
      expect(skill.toLowerCase()).not.toContain(forbidden);
    }
  });
});
