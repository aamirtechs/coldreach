import { describe, expect, it } from "vitest";
import {
  CALL_FLOW_NODES,
  CALL_FLOW_START_ID,
  flowRoadmap,
  getFlowNode,
  leadHasMobileScore,
  resolveFlowNode,
  validateFlow,
  type CallFlowNode,
} from "./callFlow";
import { isCallDisposition } from "./dispositions";
import type { ScriptLeadContext } from "./renderScript";

const SPEED_LEAD: ScriptLeadContext = {
  email: "anna@annahandylaw.com",
  fields: {
    firstName: "Anna",
    company: "Anna Handy Law Firm",
    decisionMaker: "Anna Handy",
    hook: "Your site scored 24 out of 100 on mobile and took nearly 16 seconds to load.",
    painPoints: "Mobile score 24, main content 15.9 seconds on a phone.",
    mobileScore: "24",
    lcp: "15.9s",
  },
};

const GENERIC_LEAD: ScriptLeadContext = {
  email: "stay@lookingglassinn.example",
  fields: {
    firstName: "Helene",
    company: "Looking Glass Inn",
    decisionMaker: "Helene Rosenkranz",
    hook: "Your contact page returns a 404 error today.",
    painPoints: "The contact page returns a 404, so guests who try to reach you hit a dead end.",
  },
};

function node(id: string): CallFlowNode {
  const found = getFlowNode(id);
  if (!found) throw new Error(`Missing flow node ${id}`);
  return found;
}

describe("call flow graph integrity", () => {
  it("validates clean: no problems at all", () => {
    expect(validateFlow()).toEqual([]);
  });

  it("has a start node and resolves known and unknown ids", () => {
    expect(getFlowNode(CALL_FLOW_START_ID)?.id).toBe("start");
    expect(getFlowNode("does-not-exist")).toBeUndefined();
  });

  it("every response target exists, in both variants", () => {
    for (const flowNode of CALL_FLOW_NODES) {
      for (const response of [
        ...(flowNode.responses ?? []),
        ...(flowNode.responsesGeneric ?? []),
      ]) {
        expect(getFlowNode(response.next), `${flowNode.id} -> ${response.next}`).toBeDefined();
      }
    }
  });

  it("every node is reachable from the start", () => {
    const seen = new Set<string>([CALL_FLOW_START_ID]);
    const queue = [CALL_FLOW_START_ID];
    while (queue.length > 0) {
      const current = node(queue.shift() as string);
      for (const response of [
        ...(current.responses ?? []),
        ...(current.responsesGeneric ?? []),
      ]) {
        if (!seen.has(response.next)) {
          seen.add(response.next);
          queue.push(response.next);
        }
      }
    }
    for (const flowNode of CALL_FLOW_NODES) {
      expect(seen.has(flowNode.id), flowNode.id).toBe(true);
    }
  });

  it("every path reaches a terminal: no node is a dead end or a loop-only island", () => {
    // From every node, a breadth first walk must hit a terminal.
    for (const start of CALL_FLOW_NODES) {
      const seen = new Set<string>([start.id]);
      const queue = [start.id];
      let hitTerminal = Boolean(start.terminal);
      while (queue.length > 0 && !hitTerminal) {
        const current = node(queue.shift() as string);
        for (const response of [
          ...(current.responses ?? []),
          ...(current.responsesGeneric ?? []),
        ]) {
          const target = node(response.next);
          if (target.terminal) {
            hitTerminal = true;
            break;
          }
          if (!seen.has(response.next)) {
            seen.add(response.next);
            queue.push(response.next);
          }
        }
      }
      expect(hitTerminal, start.id).toBe(true);
    }
  });

  it("terminal nodes suggest valid dispositions and carry no responses", () => {
    const terminals = CALL_FLOW_NODES.filter((flowNode) => flowNode.terminal);
    expect(terminals.length).toBeGreaterThanOrEqual(8);
    for (const terminal of terminals) {
      expect(isCallDisposition(terminal.suggestedDisposition), terminal.id).toBe(true);
      expect(terminal.responses ?? []).toEqual([]);
      expect(terminal.responsesGeneric ?? []).toEqual([]);
    }
  });

  it("the required branches exist", () => {
    const startTargets = (node("start").responses ?? []).map((r) => r.next);
    expect(startTargets).toEqual(["opener", "gatekeeperAsk", "voicemailScript", "noAnswer"]);
    expect(node("voicemailScript").suggestedDisposition).toBe("VOICEMAIL");
    expect(node("noAnswer").suggestedDisposition).toBe("NO_ANSWER");
    expect(node("gatekeeperBestTime").suggestedDisposition).toBe("CALLBACK");
    expect(node("gatekeeperBestTime").followUp).toBe(true);
    expect(node("closeReport").suggestedDisposition).toBe("INTERESTED");
    expect(node("closeWarm").followUp).toBe(true);
    expect(node("closeFile").suggestedDisposition).toBe("NOT_INTERESTED");
    expect(node("closeFileHappy").suggestedDisposition).toBe("TALKED");
    expect(node("doNotCall").suggestedDisposition).toBe("DO_NOT_CALL");
    const lateTargets = (node("notInterestedLate").responses ?? []).map((r) => r.next);
    expect(lateTargets).toContain("doNotCall");
    expect(lateTargets).toContain("closeReport");
  });

  it("validateFlow catches a broken graph", () => {
    const broken: CallFlowNode[] = [
      {
        id: "start",
        stage: "Test",
        title: "Start",
        say: "Hi",
        responses: [{ label: "Go", next: "ghost" }],
      },
      {
        id: "orphan",
        stage: "Test",
        title: "Orphan",
        say: "Nobody points here",
        terminal: true,
        suggestedDisposition: "TALKED",
      },
    ];
    const problems = validateFlow(broken);
    expect(problems.some((p) => p.includes("missing node ghost"))).toBe(true);
  });
});

describe("call flow variants for a lead", () => {
  it("detects a mobile score on the lead", () => {
    expect(leadHasMobileScore(SPEED_LEAD)).toBe(true);
    expect(leadHasMobileScore(GENERIC_LEAD)).toBe(false);
  });

  it("speed lead gets the priced offer and the price answer route", () => {
    const offer = resolveFlowNode(node("offer"), SPEED_LEAD);
    expect(offer.say).toContain("$45 and $195");
    expect(offer.say).toContain("before and after report");
    expect(offer.responses.map((r) => r.next)).toContain("priceAnswer");
    const pain = resolveFlowNode(node("painQuestion"), SPEED_LEAD);
    expect(pain.say).toContain("15.9s");
    const reason = resolveFlowNode(node("reason"), SPEED_LEAD);
    expect(reason.say).toContain("scored 24 out of 100");
    const voicemail = resolveFlowNode(node("voicemailScript"), SPEED_LEAD);
    expect(voicemail.say).toContain("scored 24 out of 100 on mobile");
    expect(voicemail.terminal).toBe(true);
  });

  it("generic lead gets the free review offer and the generic price route", () => {
    const offer = resolveFlowNode(node("offer"), GENERIC_LEAD);
    expect(offer.say).toContain("free review");
    expect(offer.say).not.toContain("$45");
    expect(offer.responses.map((r) => r.next)).toContain("priceAnswerGeneric");
    expect(offer.responses.map((r) => r.next)).not.toContain("priceAnswer");
    const price = resolveFlowNode(node("priceAnswerGeneric"), GENERIC_LEAD);
    expect(price.say).toContain("fixed price in writing");
    const pain = resolveFlowNode(node("painQuestion"), GENERIC_LEAD);
    expect(pain.say).toContain("contact page returns a 404");
    const voicemail = resolveFlowNode(node("voicemailScript"), GENERIC_LEAD);
    expect(voicemail.say).toContain("Your website report");
    expect(voicemail.say).not.toContain("{{");
  });

  it("no rendered say text leaks a raw token for either lead type", () => {
    for (const lead of [SPEED_LEAD, GENERIC_LEAD]) {
      for (const flowNode of CALL_FLOW_NODES) {
        const resolved = resolveFlowNode(flowNode, lead);
        expect(resolved.say, flowNode.id).not.toMatch(/\{\{(firstName|company|hook|mobileScore|lcp)/);
      }
    }
  });

  it("no say text anywhere contains an em dash or a ranking promise", () => {
    for (const flowNode of CALL_FLOW_NODES) {
      for (const text of [flowNode.say, flowNode.sayGeneric, flowNode.hint]) {
        if (!text) continue;
        expect(text, flowNode.id).not.toContain("—");
        expect(text.toLowerCase(), flowNode.id).not.toMatch(/guarantee.*(ranking|first page|number one)/);
      }
    }
  });
});

describe("flow roadmap", () => {
  it("groups every node under its stage, in order", () => {
    const roadmap = flowRoadmap();
    const total = roadmap.reduce((sum, group) => sum + group.nodes.length, 0);
    expect(total).toBe(CALL_FLOW_NODES.length);
    expect(roadmap[0].stage).toBe("Who answered");
    const stages = roadmap.map((group) => group.stage);
    expect(stages).toContain("Gatekeeper");
    expect(stages).toContain("Objections");
    expect(stages).toContain("Close");
    for (const group of roadmap) {
      for (const flowNode of group.nodes) expect(flowNode.stage).toBe(group.stage);
    }
  });
});
