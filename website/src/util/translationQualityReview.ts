// Post-translation AI quality review using metacognitive reasoning
// Runs Claude over the translated output to verify accuracy and correct errors
import {
	BedrockRuntimeClient,
	InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { fetchAuthSession } from "aws-amplify/auth";

const cfnOutputs = require("../cfnOutputs.json");
const MODEL_ID = "anthropic.claude-3-7-sonnet-20250219-v1:0";

const REVIEW_PROMPT = `As an elite bilingual linguist, professional translator, and localization expert, your task is to evaluate the accuracy of a translation against its original source text.

You must execute this task in sequential phases, strictly completing Phase 1 before moving on to Phase 2.

Phase 1: Context & Domain Scanning
Before looking at specific translation pairs, scan the overall source text and establish the context. Define the following parameters:
- Core Domain & Industry: (e.g., Legal/Child Protection, Medical, Technical Software, Casual Marketing)
- Target Audience & Gravitas: Who is reading this, and what are the real-world stakes of an error?
- Tone & Style: (e.g., Formal, clinical, empathetic, legally binding)
- High-Risk Terminology: Identify terms in the source text that are polysemous or domain-specific.

Phase 2: Comparative Analysis & Nuance Audit
Systematically compare the Source Text to the Translated Text. Look for:
- Contextual Blunders: Words translated literally that destroy the localized meaning.
- Reversals of Meaning: Sentences where pronouns, active/passive voice, or syntax changes alter who did what.
- False Friends & Polysemy: Words that look similar but mean different things.
- Stylistic & Nuance Failures: Awkward machine-translation artifacts, broken grammar, or unnatural phrasing.

Phase 3: Output
Return ONLY valid JSON in this exact format:
{
  "score": <number 0-100>,
  "issues": [
    {"source": "<original phrase>", "current": "<bad translation>", "error": "<error type>", "impact": "<why it matters>", "corrected": "<fixed translation>"}
  ],
  "verdict": "<fit_for_purpose|needs_correction|unsafe>"
}

If score is 95 or above, return an empty issues array and verdict "fit_for_purpose".
Be strict but fair. Cultural adaptations that preserve meaning should not be penalised.`;

const CORRECTION_PROMPT = `You are an expert translator. The following translation has been reviewed and specific errors have been identified. Apply ALL the corrections below to produce a final, polished translation.

Rules:
- Apply every correction from the issues list
- Preserve the rest of the translation exactly as-is
- Maintain natural fluency in the target language
- Do not add or remove content beyond the corrections

Return ONLY the corrected full translation text. No explanations.`;

export interface QualityReviewResult {
	score: number;
	issues: Array<{
		source: string;
		current: string;
		error: string;
		impact: string;
		corrected: string;
	}>;
	verdict: string;
	correctedText: string | null;
}

async function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
	const session = await fetchAuthSession();
	const credentials = session.credentials;
	if (!credentials) throw new Error("Not authenticated");

	const client = new BedrockRuntimeClient({
		region: cfnOutputs.awsRegion,
		credentials: {
			accessKeyId: credentials.accessKeyId,
			secretAccessKey: credentials.secretAccessKey,
			sessionToken: credentials.sessionToken,
		},
	});

	const body = JSON.stringify({
		anthropic_version: "bedrock-2023-05-31",
		max_tokens: 8192,
		messages: [{ role: "user", content: userMessage }],
		system: systemPrompt,
	});

	const response = await client.send(
		new InvokeModelCommand({
			modelId: MODEL_ID,
			contentType: "application/json",
			accept: "application/json",
			body: new TextEncoder().encode(body),
		})
	);

	const responseBody = JSON.parse(new TextDecoder().decode(response.body));
	return responseBody.content[0].text;
}

/**
 * Review a translation for accuracy and automatically correct if below threshold.
 * Returns the quality score and corrected text if needed.
 */
export async function reviewAndCorrectTranslation(
	originalText: string,
	translatedText: string,
	sourceLanguage: string,
	targetLanguage: string,
	threshold: number = 95
): Promise<QualityReviewResult> {
	// Step 1: Review
	const reviewMessage = `[SOURCE TEXT (${sourceLanguage})]\n${originalText}\n\n[TRANSLATED TEXT (${targetLanguage})]\n${translatedText}`;

	let score = 100;
	let issues: QualityReviewResult["issues"] = [];
	let verdict = "fit_for_purpose";

	try {
		const reviewResponse = await callClaude(REVIEW_PROMPT, reviewMessage);
		const jsonMatch = reviewResponse.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]);
			score = parsed.score || 100;
			issues = parsed.issues || [];
			verdict = parsed.verdict || "fit_for_purpose";
		}
	} catch (err) {
		console.error("Quality review failed:", err);
		return { score: -1, issues: [], verdict: "review_failed", correctedText: null };
	}

	// Step 2: If below threshold, apply corrections
	if (score >= threshold || issues.length === 0) {
		return { score, issues, verdict, correctedText: null };
	}

	try {
		const correctionMessage = `[CURRENT TRANSLATION]\n${translatedText}\n\n[CORRECTIONS TO APPLY]\n${JSON.stringify(issues, null, 2)}`;
		const correctedText = await callClaude(CORRECTION_PROMPT, correctionMessage);
		return { score, issues, verdict, correctedText: correctedText.trim() };
	} catch (err) {
		console.error("Translation correction failed:", err);
		return { score, issues, verdict, correctedText: null };
	}
}
