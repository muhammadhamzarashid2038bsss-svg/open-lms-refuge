// A center tag is a short skill category, such as "map reading".
// It is not a place for a family's situation, legal status, or a personal story.
// Teachers choose from the list. They do not invent a category while saving a note.

const TAG_NAME = /^[A-Za-z0-9]+(?:[ '-][A-Za-z0-9]+)*$/;

const BLOCKED_PHRASES = [
  "legal status",
  "immigration",
  "family circumstances",
  "undocumented",
  "passport",
  "asylum",
  "refugee status",
];

export const SKILL_TAG_GUIDANCE =
  "Use a short learning skill, such as map reading. Do not name family circumstances, legal status, immigration status, or a personal story.";

export function normalizeSkillTagName(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length < 2 || trimmed.length > 40) return null;
  if (!TAG_NAME.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  if (BLOCKED_PHRASES.some((phrase) => lower.includes(phrase))) return null;
  return trimmed;
}
