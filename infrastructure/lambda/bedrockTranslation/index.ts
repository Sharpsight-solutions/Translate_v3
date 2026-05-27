// Parallel translation Lambda using Claude 3.7 Sonnet via Amazon Bedrock
// Translates source documents with terminology enforcement and register-aware prompting
// Runs in parallel with AWS Translate for multi-engine comparison

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import {
	BedrockRuntimeClient,
	InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const s3 = new S3Client({});
const dynamodb = new DynamoDBClient({});
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

const MODEL_ID = "anthropic.claude-3-7-sonnet-20250219-v1:0";
const JOB_TABLE_NAME = process.env.JOB_TABLE_NAME || "";
const CONTENT_BUCKET = process.env.CONTENT_BUCKET || "";
const GLOSSARY_KEY = process.env.GLOSSARY_KEY || "docs/afc_terminology_aws.csv";
const REGISTER_PROFILES_KEY = process.env.REGISTER_PROFILES_KEY || "docs/register_profiles.json";

// ============================================================
// Glossary & Register Profile Loading (cached in Lambda memory)
// ============================================================
interface RegisterProfile {
	language: string;
	formality: string;
	honorifics: string;
	toneGuidance: string;
	culturalNotes: string;
}

let glossaryCache: Map<string, Record<string, string>> | null = null;
let glossaryLangCodes: string[] = [];
let registerProfilesCache: Record<string, RegisterProfile> | null = null;

async function getS3Text(bucket: string, key: string): Promise<string> {
	const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
	return (await response.Body?.transformToString("utf-8")) || "";
}

async function loadGlossary(): Promise<Map<string, Record<string, string>>> {
	if (glossaryCache) return glossaryCache;

	try {
		const csvText = await getS3Text(CONTENT_BUCKET, GLOSSARY_KEY);
		const lines = csvText.split("\n").filter(l => l.trim().length > 0);
		if (lines.length < 2) {
			glossaryCache = new Map();
			return glossaryCache;
		}

		glossaryLangCodes = lines[0].split(",").map(h => h.trim().toLowerCase());
		glossaryCache = new Map();

		for (let i = 1; i < lines.length; i++) {
			const cols = lines[i].split(",").map(c => c.trim());
			const enTerm = cols[0];
			if (!enTerm) continue;

			const translations: Record<string, string> = {};
			for (let j = 1; j < cols.length && j < glossaryLangCodes.length; j++) {
				if (cols[j] && cols[j].length > 0) {
					translations[glossaryLangCodes[j]] = cols[j];
				}
			}
			glossaryCache.set(enTerm.toLowerCase(), translations);
		}

		console.log(`Glossary loaded: ${glossaryCache.size} terms`);
		return glossaryCache;
	} catch (err) {
		console.error("Failed to load glossary:", err);
		glossaryCache = new Map();
		return glossaryCache;
	}
}

async function loadRegisterProfiles(): Promise<Record<string, RegisterProfile>> {
	if (registerProfilesCache) return registerProfilesCache;

	try {
		const jsonText = await getS3Text(CONTENT_BUCKET, REGISTER_PROFILES_KEY);
		registerProfilesCache = JSON.parse(jsonText);
		console.log(`Register profiles loaded: ${Object.keys(registerProfilesCache!).length} languages`);
		return registerProfilesCache!;
	} catch (err) {
		console.error("Failed to load register profiles:", err);
		registerProfilesCache = {};
		return registerProfilesCache;
	}
}

// ============================================================
// Build Translation Prompt
// ============================================================
function buildTranslationPrompt(
	sourceLang: string,
	targetLang: string,
	registerProfile: RegisterProfile | null,
	relevantTerms: Array<{ en: string; target: string }>
): string {
	let prompt = `You are a professional translator specialising in UK children's services and safeguarding documents. Translate the following document from ${sourceLang} to ${targetLang}.

Your translation must be:
- Accurate: preserve all factual content, names, dates, reference numbers exactly
- Natural: read as if written by a native-speaking social work professional
- Complete: translate every sentence, do not summarise or skip content
- Domain-aware: use correct safeguarding and child protection terminology`;

	// Add register guidance
	if (registerProfile) {
		prompt += `

LANGUAGE REGISTER (${registerProfile.language}):
- Formality: ${registerProfile.formality}
- Honorifics: ${registerProfile.honorifics}
- Tone: ${registerProfile.toneGuidance}
- Cultural notes: ${registerProfile.culturalNotes}`;
	} else {
		prompt += `

LANGUAGE REGISTER: Use formal, professional register throughout. This is an official government document.`;
	}

	// Add terminology constraints
	if (relevantTerms.length > 0) {
		prompt += `

MANDATORY TERMINOLOGY — use these exact translations:`;
		for (const term of relevantTerms.slice(0, 50)) {
			prompt += `\n- "${term.en}" → "${term.target}"`;
		}
	}

	prompt += `

CRITICAL RULES:
- NEVER translate proper nouns (street names, organisation names, school names)
- NEVER translate database field labels or reference numbers
- NEVER translate case reference numbers, tracking IDs, or postcodes
- Preserve all dates in their original format (dd/mm/yyyy or similar)
- Preserve all phone numbers, email addresses, and URLs unchanged
- Professional framework names (e.g. "Zones of Regulation", "Incredible Years") should be kept as proper nouns or use established translations
- "coaching" in safeguarding context means witness tampering/priming (NOT sports training)
- "Present" in date fields means "current/today" (NOT a physical object)
- Ethnicity fields like "Any other white background" refer to heritage/origin (NOT wallpaper)

OUTPUT: Return ONLY the translated text. No explanations, no preamble, no notes.`;

	return prompt;
}

// ============================================================
// Translate a single document for one target language
// ============================================================
async function translateWithClaude(
	sourceText: string,
	sourceLang: string,
	targetLang: string,
	systemPrompt: string
): Promise<string> {
	// Claude has a ~200k token context window, but we limit to avoid excessive cost
	// For very large documents, take first 60000 chars (~15000 words)
	const textToTranslate = sourceText.substring(0, 60000);

	const body = JSON.stringify({
		anthropic_version: "bedrock-2023-05-31",
		max_tokens: 16384,
		messages: [{ role: "user", content: textToTranslate }],
		system: systemPrompt,
	});

	const response = await bedrock.send(
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

// ============================================================
// Main Handler
// ============================================================
export const handler = async (event: any) => {
	const jobDetails = event.jobDetails || event;
	const jobId = jobDetails.jobId;
	const s3PrefixToObject = jobDetails.s3PrefixToObject;
	const s3PrefixToJobId = jobDetails.s3PrefixToJobId;
	const sourceLang = jobDetails.languageSource || "en";
	const languageTargets = jobDetails.languageTargets || [];

	console.log(`Bedrock translation starting for job ${jobId}, source: ${sourceLang}, targets: ${JSON.stringify(languageTargets)}`);

	try {
		// Read source text from S3
		let sourceText = "";
		try {
			sourceText = await getS3Text(CONTENT_BUCKET, s3PrefixToObject);
		} catch (err) {
			// Try upload folder path
			console.log("Direct source path failed, trying upload folder...");
			try {
				const jobName = jobDetails.jobName || "";
				const uploadPath = `${s3PrefixToJobId}/upload/${jobName}`;
				sourceText = await getS3Text(CONTENT_BUCKET, uploadPath);
			} catch (err2) {
				console.error("Could not read source file:", err2);
				return { statusCode: 200, body: "Source file not accessible, skipping Bedrock translation" };
			}
		}

		if (!sourceText || sourceText.length < 20) {
			console.log("Source text too short for translation, skipping");
			return { statusCode: 200, body: "Skipped - source too short" };
		}

		// Load glossary and register profiles
		const glossary = await loadGlossary();
		const registerProfiles = await loadRegisterProfiles();

		// Parse target languages
		let targets: string[] = [];
		if (Array.isArray(languageTargets)) {
			// Could be array of {S: "xx"} from DynamoDB or plain strings
			targets = languageTargets.map((t: any) => {
				if (typeof t === "string") return t;
				if (t.S) return t.S;
				return String(t);
			});
		}

		if (targets.length === 0) {
			console.log("No target languages specified");
			return { statusCode: 200, body: "No target languages" };
		}

		console.log(`Translating to ${targets.length} languages: ${targets.join(", ")}`);

		// Translate for each target language
		const bedrockTranslateKey: Record<string, string> = {};
		const results: Array<{ lang: string; success: boolean; length: number; error?: string }> = [];

		for (const targetLang of targets) {
			try {
				console.log(`Translating to ${targetLang}...`);

				// Get relevant terminology for this language
				const relevantTerms: Array<{ en: string; target: string }> = [];
				const sourceTextLower = sourceText.toLowerCase();
				for (const [enTerm, translations] of glossary) {
					if (sourceTextLower.includes(enTerm) && translations[targetLang]) {
						relevantTerms.push({ en: enTerm, target: translations[targetLang] });
					}
				}

				// Get register profile
				const registerProfile = registerProfiles[targetLang] || null;

				// Build prompt
				const systemPrompt = buildTranslationPrompt(sourceLang, targetLang, registerProfile, relevantTerms);

				// Translate
				const translatedText = await translateWithClaude(sourceText, sourceLang, targetLang, systemPrompt);

				if (translatedText && translatedText.length > 10) {
					// Store in S3
					const outputKey = `${s3PrefixToJobId}/bedrock-output/${targetLang}/${jobDetails.jobName || "translation.txt"}`;
					await s3.send(
						new PutObjectCommand({
							Bucket: CONTENT_BUCKET,
							Key: outputKey,
							Body: translatedText,
							ContentType: "text/plain; charset=utf-8",
						})
					);

					bedrockTranslateKey[`lang${targetLang}`] = `s3://${CONTENT_BUCKET}/${outputKey}`;
					results.push({ lang: targetLang, success: true, length: translatedText.length });
					console.log(`✓ ${targetLang}: ${translatedText.length} chars stored at ${outputKey}`);
				} else {
					results.push({ lang: targetLang, success: false, length: 0, error: "Empty response" });
					console.log(`✗ ${targetLang}: Empty response from Claude`);
				}
			} catch (err: any) {
				results.push({ lang: targetLang, success: false, length: 0, error: err.message });
				console.error(`✗ ${targetLang}: Translation failed:`, err.message);
				// Continue with other languages — don't fail the whole job
			}
		}

		// Write bedrockTranslateKey to DynamoDB
		if (Object.keys(bedrockTranslateKey).length > 0) {
			await dynamodb.send(
				new UpdateItemCommand({
					TableName: JOB_TABLE_NAME,
					Key: { id: { S: jobId } },
					UpdateExpression: "SET bedrockTranslateKey = :btk",
					ExpressionAttributeValues: {
						":btk": { S: JSON.stringify(bedrockTranslateKey) },
					},
				})
			);
			console.log(`bedrockTranslateKey written to DynamoDB: ${Object.keys(bedrockTranslateKey).length} languages`);
		}

		const successCount = results.filter(r => r.success).length;
		console.log(`Bedrock translation complete for job ${jobId}. Success: ${successCount}/${targets.length}`);

		return {
			statusCode: 200,
			body: JSON.stringify({
				jobId,
				languagesTranslated: successCount,
				totalLanguages: targets.length,
				results,
			}),
		};
	} catch (err) {
		console.error("Bedrock translation error:", err);
		// Don't throw — allow pipeline to continue with AWS Translate output
		return { statusCode: 200, body: `Bedrock translation failed: ${String(err)}` };
	}
};
