import { jsonSchemaForPrompt } from "./schema.ts";

export const EXTRACTION_PROMPT = `You are analyzing HANDWRITING CHARACTERISTICS ONLY in a single image, for an academic-integrity consistency check.

STRICT RULES
- Do NOT identify the person and do NOT infer identity.
- Do NOT evaluate or use the meaning of the text, the words, the subject, the language, the answers or the topic.
- Do NOT use page layout, headings, margins, diagrams, ruled lines or printed text as handwriting evidence.
- Focus only on stable visual handwriting traits: slant, stroke weight, letter/word spacing, baseline behaviour, letter size and proportions, ascenders/descenders, loops, roundness, connectivity, and recurring shapes of individual characters.
- If a characteristic cannot be reliably observed, return "unknown". NEVER guess.
- If the image is blurry, too dark, cropped, or has too little handwriting to judge, set quality_status accordingly and return "unknown" for features you cannot see.
- If the content is typed or printed rather than handwritten, set is_handwritten=false and quality_status="not_handwriting".
- Confidence values are 0..1 and must reflect how clearly each trait is visible.

VALUE GUIDE
- slant: dominant angle of vertical strokes (left / upright / right).
- stroke_weight: line thickness relative to a normal ballpoint.
- letter_spacing: gaps between letters inside words. word_spacing: gaps between words, relative to letter size.
- baseline: how straight the writing sits on its own line. line_direction: overall drift of lines across the page.
- letter_height: size of lowercase body relative to line spacing. ascender_ratio: ascenders (b,d,h,k,l) relative to lowercase body.
- writing_style / connectivity: print vs cursive; how often letters join.
- letter_roundness: curved vs sharp turns. loop_size: loops on l, h, g, y, etc.
- characters: dominant form of each listed lowercase letter; "unknown" if the letter does not appear clearly.

Return ONLY a single JSON object with exactly this shape (no markdown, no explanation):
${jsonSchemaForPrompt()}`;
