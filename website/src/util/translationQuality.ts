// Translation quality verification and refinement using Claude
import {
	BedrockRuntimeClient,
	InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { fetchAuthSession } from "aws-amplify/auth";

const cfnOutputs = require("../cfnOutputs.json");
const MODEL_ID = "anthropic.claude-3-7-sonnet-20250219-v1:0";

interface QualityResult {
	score: number;
	issues: string[];
	refinedTranslation: string | null;
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
		max_tokens: 4096,
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
 * Verify translation quality by comparing original and translated text.
 * If score is below threshold, automatically refine the translation.
 */
export async function verifyAndRefineTranslation(
	originalText: string,
	translatedText: string,
	sourceLanguage: string,
	targetLanguage: string,
	threshold: number = 95
): Promise<QualityResult> {
	// Step 1: Verify quality
	const verifyPrompt = `You are a professional translation quality assessor. Compare the original text with its translation and assess how well the meaning, context, tone, and messaging is preserved.

Score the translation from 0 to 100 where:
- 100 = Perfect preservation of meaning, nothing lost or added
- 95+ = Excellent, minor stylistic differences only
- 85-94 = Good, but some nuance or context is slightly off
- 70-84 = Acceptable, but noticeable meaning drift
- Below 70 = Poor, significant meaning lost or changed

Return ONLY valid JSON in this exact format:
{"score": <number>, "issues": ["issue 1", "issue 2"]}

If score is 95+, return an empty issues array.
Be strict but fair. Cultural adaptations that preserve meaning should not be penalised.`;

	const verifyMessage = `ORIGINAL (${sourceLanguage}):\n${originalText}\n\nTRANSLATION (${targetLanguage}):\n${translatedText}`;

	let score = 100;
	let issues: string[] = [];

	try {
		const verifyResponse = await callClaude(verifyPrompt, verifyMessage);
		const jsonMatch = verifyResponse.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]);
			score = parsed.score || 100;
			issues = parsed.issues || [];
		}
	} catch (err) {
		console.error("Quality verification failed:", err);
		return { score: -1, issues: ["Verification failed"], refinedTranslation: null };
	}

	// Step 2: If below threshold, refine
	if (score >= threshold) {
		return { score, issues, refinedTranslation: null };
	}

	try {
		const refinePrompt = `You are an expert translator and editor. The following translation has quality issues. Your job is to produce a refined translation that achieves as close to 100% meaning preservation as possible.

Rules:
- Preserve ALL meaning, context, tone, and messaging from the original
- Fix any awkward phrasing, lost nuance, or meaning drift
- Maintain natural fluency in the target language
- Do not add information that isn't in the original
- Do not omit information that is in the original
- Cultural adaptations are acceptable if they preserve meaning

Return ONLY the refined translation. No explanations.`;

		const refineMessage = `ORIGINAL (${sourceLanguage}):\n${originalText}\n\nCURRENT TRANSLATION (${targetLanguage}):\n${translatedText}\n\nISSUES IDENTIFIED:\n${issues.join("\n")}`;

		const refinedTranslation = await callClaude(refinePrompt, refineMessage);
		return { score, issues, refinedTranslation: refinedTranslation.trim() };
	} catch (err) {
		console.error("Translation refinement failed:", err);
		return { score, issues, refinedTranslation: null };
	}
}
