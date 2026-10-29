/**
 * Spintax rendering.
 *
 * Templates may contain {option a|option b|option c} groups, and a
 * group may be nested inside an option of another group. Rendering
 * picks one option per group and never throws: text without valid
 * spintax is returned unchanged, and malformed fragments (an opening
 * brace with no matching close, a lone closing brace, or a group with
 * no pipe) are left as literal text so an authoring mistake shows up
 * in the output instead of crashing a send.
 *
 * Choices are deterministic for a given seed: the same seed and the
 * same text always render the same result, so a campaign can be
 * previewed and re-rendered without the copy changing. A per-group
 * counter is mixed into the hash so different groups in the same text
 * do not all land on the same option index.
 */

function hashChoice(seed: string, counter: number, optionCount: number): number {
  // FNV-1a, a small stable hash. It only needs to be deterministic
  // across calls and processes, not cryptographic.
  let hash = 2166136261;
  const input = `${seed}:${counter}`;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % optionCount;
}

/** Index of the closing brace matching the opening brace at `start`, or -1. */
function findMatchingClose(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") {
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/** Splits group content on pipes that sit at the top nesting level. */
function splitOptions(content: string): string[] {
  const options: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
    }
    if (char === "|" && depth === 0) {
      options.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  options.push(current);
  return options;
}

interface RenderState {
  seed: string;
  counter: number;
}

function renderSegment(text: string, state: RenderState): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "}") {
      // A lone closing brace has no group to close.
      out += char;
      i++;
      continue;
    }
    if (char !== "{") {
      out += char;
      i++;
      continue;
    }
    const close = findMatchingClose(text, i);
    if (close === -1) {
      // No matching close: the rest of the text is literal.
      out += text.slice(i);
      break;
    }
    const options = splitOptions(text.slice(i + 1, close));
    if (options.length < 2) {
      // A group with no pipe is not spintax; keep it exactly as written.
      out += text.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    const index = hashChoice(state.seed, state.counter, options.length);
    state.counter++;
    // Only the chosen option is rendered, so nested groups inside an
    // option that was not picked never consume a counter value.
    out += renderSegment(options[index], state);
    i = close + 1;
  }
  return out;
}

export function renderSpintax(text: string, seed: string): string {
  return renderSegment(text, { seed, counter: 0 });
}
