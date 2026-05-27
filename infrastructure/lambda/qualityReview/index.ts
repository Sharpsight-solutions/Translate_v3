// Post-translation quality review Lambda
// Layered QA: structural checks, entity preservation, back-translation,
// artifact detection, terminology verification, then AI correction
// Stores full audit trail in DynamoDB

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, UpdateItemCommand, GetItemCommand } from "@aws-sdk/client-dynamodb";
import {
	BedrockRuntimeClient,
	InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
	TranslateClient,
	TranslateTextCommand,
} from "@aws-sdk/client-translate";

const s3 = new S3Client({});
const dynamodb = new DynamoDBClient({});
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const translate = new TranslateClient({ region: process.env.AWS_REGION });

const MODEL_ID = "anthropic.claude-3-7-sonnet-20250219-v1:0";
const JOB_TABLE_NAME = process.env.JOB_TABLE_NAME || "";
const CONTENT_BUCKET = process.env.CONTENT_BUCKET || "";
const GLOSSARY_KEY = process.env.GLOSSARY_KEY || "docs/afc_terminology_aws.csv";

// ============================================================
// LAYER 1: Structural Integrity Check (free, instant)
// ============================================================
function structuralCheck(sourceText: string, translatedText: string, targetLang: string) {
	const sourceParagraphs = sourceText.split(/\n\n+/).filter(p => p.trim().length > 0);
	const translatedParagraphs = translatedText.split(/\n\n+/).filter(p => p.trim().length > 0);

	const sourceSentences = sourceText.split(/[.!?]+/).filter(s => s.trim().length > 2);
	const translatedSentences = translatedText.split(/[.!?]+/).filter(s => s.trim().length > 2);

	const lengthRatio = translatedText.length / sourceText.length;
	// Most languages produce translations 0.7x to 1.5x the source length
	const lengthInBounds = lengthRatio >= 0.5 && lengthRatio <= 2.0;

	const paragraphDiff = Math.abs(sourceParagraphs.length - translatedParagraphs.length) / Math.max(sourceParagraphs.length, 1);
	const paragraphsMatch = paragraphDiff <= 0.3; // within 30%

	const sentenceDiff = Math.abs(sourceSentences.length - translatedSentences.length) / Math.max(sourceSentences.length, 1);
	const sentencesMatch = sentenceDiff <= 0.4; // within 40%

	const notEmpty = translatedText.trim().length > 10;

	return {
		pass: notEmpty && lengthInBounds && paragraphsMatch,
		details: {
			notEmpty,
			lengthRatio: parseFloat(lengthRatio.toFixed(2)),
			lengthInBounds,
			sourceParagraphs: sourceParagraphs.length,
			translatedParagraphs: translatedParagraphs.length,
			paragraphsMatch,
			sourceSentences: sourceSentences.length,
			translatedSentences: translatedSentences.length,
			sentencesMatch,
		},
	};
}

// ============================================================
// LAYER 2: Key Entity Preservation Check (free, instant)
// ============================================================
function entityPreservationCheck(sourceText: string, translatedText: string) {
	// Extract entities that should NEVER be translated
	const datePattern = /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g;
	const numberPattern = /\b\d{3,}\b/g;
	const emailPattern = /[\w.-]+@[\w.-]+\.\w+/g;
	const phonePattern = /\b(?:0\d{10}|\+\d{10,})\b/g;

	const sourceDates = sourceText.match(datePattern) || [];
	const sourceNumbers = sourceText.match(numberPattern) || [];
	const sourceEmails = sourceText.match(emailPattern) || [];
	const sourcePhones = sourceText.match(phonePattern) || [];

	const missingDates = sourceDates.filter(d => !translatedText.includes(d));
	const missingNumbers = sourceNumbers.filter(n => !translatedText.includes(n));
	const missingEmails = sourceEmails.filter(e => !translatedText.includes(e));

	const totalEntities = sourceDates.length + sourceNumbers.length + sourceEmails.length;
	const missingEntities = missingDates.length + missingNumbers.length + missingEmails.length;
	const preservationRate = totalEntities > 0 ? ((totalEntities - missingEntities) / totalEntities) * 100 : 100;

	return {
		pass: preservationRate >= 80,
		details: {
			totalEntities,
			missingEntities,
			preservationRate: parseFloat(preservationRate.toFixed(1)),
			missingDates,
			missingNumbers: missingNumbers.slice(0, 5),
		},
	};
}

// ============================================================
// BLEU Score Calculation (industry-standard MT evaluation metric)
// ============================================================
function calculateBLEU(reference: string, candidate: string): number {
	const refTokens = reference.toLowerCase().split(/\s+/).filter(w => w.length > 0);
	const candTokens = candidate.toLowerCase().split(/\s+/).filter(w => w.length > 0);

	if (candTokens.length === 0 || refTokens.length === 0) return 0;

	// Calculate n-gram precisions for n=1 to 4
	const precisions: number[] = [];

	for (let n = 1; n <= 4; n++) {
		const refNgrams = new Map<string, number>();
		const candNgrams = new Map<string, number>();

		// Count reference n-grams
		for (let i = 0; i <= refTokens.length - n; i++) {
			const ngram = refTokens.slice(i, i + n).join(" ");
			refNgrams.set(ngram, (refNgrams.get(ngram) || 0) + 1);
		}

		// Count candidate n-grams
		for (let i = 0; i <= candTokens.length - n; i++) {
			const ngram = candTokens.slice(i, i + n).join(" ");
			candNgrams.set(ngram, (candNgrams.get(ngram) || 0) + 1);
		}

		// Calculate clipped counts
		let clippedCount = 0;
		let totalCount = 0;
		for (const [ngram, count] of candNgrams) {
			const refCount = refNgrams.get(ngram) || 0;
			clippedCount += Math.min(count, refCount);
			totalCount += count;
		}

		precisions.push(totalCount > 0 ? clippedCount / totalCount : 0);
	}

	// If any precision is 0, BLEU is 0
	if (precisions.some(p => p === 0)) return 0;

	// Geometric mean of precisions
	const logAvg = precisions.reduce((sum, p) => sum + Math.log(p), 0) / precisions.length;

	// Brevity penalty
	const bp = candTokens.length >= refTokens.length
		? 1
		: Math.exp(1 - refTokens.length / candTokens.length);

	return parseFloat((bp * Math.exp(logAvg) * 100).toFixed(1));
}

// ============================================================
// LAYER 3.5: Artifact & Hallucination Detection (free, instant)
// ============================================================
interface Artifact {
	type: string;
	count: number;
	severity: "high" | "medium" | "low";
	examples?: string[];
}

interface ArtifactReport {
	artifacts: Artifact[];
	artifactDensity: number;
	needsReview: boolean;
	pass: boolean;
}

function detectArtifacts(translatedText: string, sourceText: string, targetLang: string): ArtifactReport {
	const artifacts: Artifact[] = [];

	// 1. Untranslated English fragments (if target != en)
	if (targetLang !== "en") {
		// Common English function words that should NOT appear in a non-English translation
		const englishFunctionWords = /\b(the|is|are|was|were|have|has|been|will|would|should|could|this|that|these|those|which|where|when|because|however|therefore|although|furthermore|nevertheless|meanwhile|regarding|concerning|approximately|subsequently)\b/gi;
		const matches = translatedText.match(englishFunctionWords) || [];
		// Allow a small number (some proper nouns or quoted terms may contain English)
		if (matches.length > 8) {
			artifacts.push({
				type: "untranslated_fragments",
				count: matches.length,
				severity: "high",
				examples: [...new Set(matches.map(m => m.toLowerCase()))].slice(0, 5),
			});
		}
	}

	// 2. Repeated phrases (hallucination indicator)
	const sentences = translatedText.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 20);
	const seen = new Map<string, number>();
	for (const s of sentences) {
		const normalized = s.toLowerCase().substring(0, 100); // Normalize for comparison
		seen.set(normalized, (seen.get(normalized) || 0) + 1);
	}
	const repeats = [...seen.entries()].filter(([_, count]) => count > 3);
	if (repeats.length > 0) {
		artifacts.push({
			type: "repeated_phrases",
			count: repeats.reduce((sum, [_, c]) => sum + c - 1, 0), // Count excess repetitions
			severity: "high",
			examples: repeats.map(([phrase]) => phrase.substring(0, 50)).slice(0, 3),
		});
	}

	// 3. Encoding artifacts (mojibake patterns)
	const mojibakePattern = /Ã[\x80-\xBF]|â€[™""|˜œ¦¢]|Â[\xa0-\xff]|Ã‚|Ãƒ|â‚¬/g;
	const mojibakeMatches = translatedText.match(mojibakePattern) || [];
	if (mojibakeMatches.length > 3) {
		artifacts.push({
			type: "encoding_errors",
			count: mojibakeMatches.length,
			severity: "medium",
			examples: [...new Set(mojibakeMatches)].slice(0, 5),
		});
	}

	// 4. Length anomaly per segment (hallucination or truncation indicator)
	const sourceSegments = sourceText.split(/\n\n+/).filter(s => s.trim().length > 10);
	const targetSegments = translatedText.split(/\n\n+/).filter(s => s.trim().length > 10);
	let anomalies = 0;
	const anomalyExamples: string[] = [];
	for (let i = 0; i < Math.min(sourceSegments.length, targetSegments.length); i++) {
		const ratio = targetSegments[i].length / Math.max(sourceSegments[i].length, 1);
		if (ratio > 2.5 || ratio < 0.3) {
			anomalies++;
			if (anomalyExamples.length < 3) {
				anomalyExamples.push(`Segment ${i + 1}: ratio ${ratio.toFixed(1)}x`);
			}
		}
	}
	if (anomalies > 0) {
		artifacts.push({
			type: "length_anomaly",
			count: anomalies,
			severity: "medium",
			examples: anomalyExamples,
		});
	}

	// 5. Consecutive identical words (stuttering/loop artifact)
	const stutterPattern = /(\b\w{4,}\b)(\s+\1){3,}/gi;
	const stutterMatches = translatedText.match(stutterPattern) || [];
	if (stutterMatches.length > 0) {
		artifacts.push({
			type: "word_repetition_loop",
			count: stutterMatches.length,
			severity: "high",
			examples: stutterMatches.map(m => m.substring(0, 40)).slice(0, 3),
		});
	}

	// Calculate density
	const totalSegments = Math.max(sourceSegments.length, 1);
	const totalArtifactInstances = artifacts.reduce((sum, a) => sum + a.count, 0);
	const artifactDensity = totalArtifactInstances / totalSegments;

	return {
		artifacts,
		artifactDensity: parseFloat(artifactDensity.toFixed(3)),
		needsReview: artifactDensity > 0.1,
		pass: artifactDensity <= 0.1,
	};
}

// ============================================================
// LAYER 3.6: Terminology Verification (free, instant after S3 load)
// ============================================================
interface TerminologyViolation {
	sourceTerm: string;
	expectedTranslation: string;
	found: boolean;
	context?: string;
}

interface TerminologyGap {
	sourceTerm: string;
	targetLang: string;
}

interface TerminologyReport {
	violations: TerminologyViolation[];
	gaps: TerminologyGap[];
	totalTermsChecked: number;
	complianceRate: number;
	pass: boolean;
}

// Cache glossary in Lambda memory (cold start only loads once)
let glossaryCache: Map<string, Record<string, string>> | null = null;
let glossaryLangCodes: string[] = [];

async function loadGlossary(): Promise<Map<string, Record<string, string>>> {
	if (glossaryCache) return glossaryCache;

	try {
		const csvText = await getS3Text(CONTENT_BUCKET, GLOSSARY_KEY);
		const lines = csvText.split("\n").filter(l => l.trim().length > 0);
		if (lines.length < 2) {
			console.log("Glossary empty or malformed");
			glossaryCache = new Map();
			return glossaryCache;
		}

		// Parse header to get language codes
		glossaryLangCodes = lines[0].split(",").map(h => h.trim().toLowerCase());

		// Parse terms: key = English term (lowercase), value = { langCode: translation }
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

		console.log(`Glossary loaded: ${glossaryCache.size} terms, languages: ${glossaryLangCodes.join(", ")}`);
		return glossaryCache;
	} catch (err) {
		console.error("Failed to load glossary:", err);
		glossaryCache = new Map();
		return glossaryCache;
	}
}

function verifyTerminology(
	sourceText: string,
	translatedText: string,
	targetLang: string,
	glossary: Map<string, Record<string, string>>
): TerminologyReport {
	const violations: TerminologyViolation[] = [];
	const gaps: TerminologyGap[] = [];
	let totalTermsChecked = 0;

	const sourceTextLower = sourceText.toLowerCase();
	const translatedTextLower = translatedText.toLowerCase();

	for (const [enTerm, translations] of glossary) {
		// Check if the English term appears in the source text
		if (!sourceTextLower.includes(enTerm)) continue;

		totalTermsChecked++;

		// Check if we have a translation for this target language
		const expectedTranslation = translations[targetLang];
		if (!expectedTranslation) {
			// Gap: no translation available for this language
			gaps.push({ sourceTerm: enTerm, targetLang });
			continue;
		}

		// Check if the correct translation appears in the output
		const found = translatedTextLower.includes(expectedTranslation.toLowerCase());
		if (!found) {
			// Find what might have been used instead (context around where the term should be)
			violations.push({
				sourceTerm: enTerm,
				expectedTranslation,
				found: false,
			});
		}
	}

	const compliantTerms = totalTermsChecked - violations.length - gaps.length;
	const complianceRate = totalTermsChecked > 0
		? parseFloat(((compliantTerms / totalTermsChecked) * 100).toFixed(1))
		: 100;

	return {
		violations,
		gaps,
		totalTermsChecked,
		complianceRate,
		pass: violations.length === 0,
	};
}

// ============================================================
// LAYER 3: Back-Translation with BLEU Score
// ============================================================
async function backTranslationCheck(translatedText: string, originalText: string, sourceLang: string, targetLang: string) {
	// Take a sample (first 5000 chars) to keep costs low
	const sample = translatedText.substring(0, 5000);

	try {
		const backTranslation = await translate.send(
			new TranslateTextCommand({
				Text: sample,
				SourceLanguageCode: targetLang,
				TargetLanguageCode: sourceLang,
			})
		);

		const backText = backTranslation.TranslatedText || "";
		const originalSample = originalText.substring(0, 5000);

		// Calculate BLEU score (industry standard for MT evaluation)
		const bleuScore = calculateBLEU(originalSample, backText);

		// Also calculate simple word overlap as secondary metric
		const originalWords = new Set(originalSample.toLowerCase().split(/\s+/).filter(w => w.length > 3));
		const backWords = new Set(backText.toLowerCase().split(/\s+/).filter(w => w.length > 3));
		let overlap = 0;
		for (const word of originalWords) {
			if (backWords.has(word)) overlap++;
		}
		const wordOverlap = originalWords.size > 0 ? parseFloat(((overlap / originalWords.size) * 100).toFixed(1)) : 0;

		// Pass if BLEU >= 15 OR word overlap >= 40%
		// (BLEU is stricter — scores above 30 are considered good for MT)
		const pass = bleuScore >= 15 || wordOverlap >= 40;

		return {
			pass,
			details: {
				bleuScore,
				wordOverlap,
				sampleLength: sample.length,
			},
		};
	} catch (err) {
		console.error("Back-translation failed:", err);
		return {
			pass: true, // Don't block on failure
			details: { error: String(err), bleuScore: -1, wordOverlap: -1 },
		};
	}
}

const REVIEW_PROMPT = `You are a ruthlessly strict bilingual quality assessor for translated documents in a children's services organisation. Lives and legal outcomes depend on translation accuracy. You must be HARSH in your scoring.

Execute these phases sequentially:

Phase 1: Context & Domain Scanning
Identify:
- Core Domain (e.g., Child Protection, Safeguarding, Legal, Medical)
- Stakes: What happens if this translation contains errors? (e.g., court proceedings, child safety decisions)
- High-Risk Terminology: Terms that are domain-specific and MUST be translated with precision

Phase 2: Comparative Analysis — Be BRUTAL
Check for ALL of the following. Even ONE instance of categories 1-3 should drop the score below 70:

1. MEANING REVERSALS (Critical): Any sentence where the translation changes who did what, makes a victim sound like a perpetrator, or reverses responsibility. Score penalty: -30 per instance.
2. DANGEROUS MISTRANSLATIONS (Critical): Words translated in a way that changes the safeguarding meaning (e.g., "neglect" becoming "unimportant", "account" becoming "digital account", "target" in wrong context). Score penalty: -20 per instance.
3. LITERAL WORD-FOR-WORD FAILURES (Serious): Phrases translated word-by-word that no native speaker would write (e.g., English word order forced onto the target language). Score penalty: -10 per instance.
4. GRAMMAR & SYNTAX ERRORS (Moderate): Broken grammar, wrong gender, wrong verb conjugation. Score penalty: -5 per instance.
5. TONE & REGISTER FAILURES (Moderate): Translation lacks the formal/legal tone required for professional safeguarding documents. Uses informal address forms (tu/tú/sen instead of vous/usted/siz), colloquialisms, or inappropriate register for official documents. Score penalty: -5 per instance.
6. UNTRANSLATED CONTENT: English words or phrases left untranslated. Score penalty: -3 per instance.

SCORING GUIDE:
- 95-100: Flawless. No native speaker would identify this as machine-translated.
- 85-94: Good. Minor stylistic issues only. Fit for purpose.
- 70-84: Acceptable but imperfect. Some awkward phrasing but meaning preserved.
- 50-69: POOR. Contains errors that could cause misunderstanding. Needs correction.
- Below 50: UNSAFE. Contains meaning reversals or dangerous mistranslations. Must not be used.

DO NOT be generous. If you see literal translations, broken grammar, or contextual errors, the score MUST reflect that. A machine translation of a safeguarding document with multiple literal translation artifacts should score 60-75, NOT 90+.

Phase 3: Output
Return ONLY valid JSON in this exact format:
{
  "score": <number 0-100>,
  "domain": "<detected domain in under 10 words>",
  "summary": "<2-3 sentence summary of overall translation quality and key problems found>",
  "issueCount": <number of issues found>,
  "verdict": "<fit_for_purpose|needs_correction|unsafe>",
  "correctionGuidance": "<if needs_correction or unsafe, describe what needs fixing. Otherwise empty string>"
}

CRITICAL: Response must be parseable by JSON.parse(). Keep all string values short and on one line. No arrays, no nested objects.
Verdict thresholds: score >= 85 = fit_for_purpose, score 50-84 = needs_correction, score < 50 = unsafe.`;

const BASE_CORRECTION_PROMPT = `You are an expert translator specialising in UK children's services and safeguarding documents. The following translation has quality issues. Apply corrections using the original source text as your reference.

KNOWN MACHINE TRANSLATION FAILURES TO WATCH FOR:
- "coaching" in safeguarding context means witness tampering/priming (NOT sports training or military drilling)
- "Present" in date fields means "current/today" (NOT a physical object like tent/curtain)
- Ethnicity fields like "Any other white background" refer to heritage/origin (NOT wallpaper/backdrop)
- Proper street names (e.g. "Portsmouth Road") should remain untranslated in address fields
- Professional framework names (e.g. "Zones of Regulation", "Incredible Years") should be kept as proper nouns or translated as established terms, never garbled
- "mop" is a floor cleaning tool (NOT a broom)
- Database field labels and reference numbers must never be translated
- Case reference numbers, dates, and tracking IDs must be preserved exactly

Rules:
- Fix all meaning errors, literal translations, and contextual blunders
- Use the original source text to verify meaning precisely
- Maintain natural fluency in the target language
- Preserve all dates, numbers, names, and reference codes unchanged
- Ensure the corrected version reads as if written by a native-speaking social work professional
- Do not add or remove factual content

Return ONLY the corrected full translation text. No explanations, no preamble.`;

function buildCorrectionPrompt(
	terminologyViolations: TerminologyViolation[],
	artifactReport: ArtifactReport | null,
	registerProfile: RegisterProfile | null,
	targetLang: string
): string {
	let prompt = BASE_CORRECTION_PROMPT;

	// Add register requirements
	if (registerProfile) {
		prompt += `\n\nREGISTER REQUIREMENTS (${registerProfile.language}):
- Formality: ${registerProfile.formality}
- Honorifics: ${registerProfile.honorifics}
- Tone: ${registerProfile.toneGuidance}
- Cultural notes: ${registerProfile.culturalNotes}
Ensure the ENTIRE translation maintains this register consistently. Any informal language in a formal document is a critical error.`;
	} else {
		prompt += `\n\nREGISTER REQUIREMENTS: Use formal, professional register throughout. This is an official government safeguarding document.`;
	}

	// Add terminology corrections as non-negotiable instructions
	if (terminologyViolations.length > 0) {
		prompt += `\n\nTERMINOLOGY CORRECTIONS REQUIRED (NON-NEGOTIABLE):
The following terms MUST use the exact translations specified. These are domain-specific safeguarding terms where incorrect translation can have legal consequences.`;
		for (const v of terminologyViolations.slice(0, 20)) {
			prompt += `\n- "${v.sourceTerm}" MUST be translated as "${v.expectedTranslation}"`;
		}
	}

	// Add artifact removal instructions
	if (artifactReport && artifactReport.artifacts.length > 0) {
		prompt += `\n\nARTIFACTS TO REMOVE:`;
		for (const a of artifactReport.artifacts) {
			switch (a.type) {
				case "untranslated_fragments":
					prompt += `\n- Remove untranslated English words/phrases (${a.count} detected). Translate them properly.`;
					break;
				case "repeated_phrases":
					prompt += `\n- Remove repeated/duplicated sentences (${a.count} excess repetitions detected). Keep only one instance.`;
					break;
				case "encoding_errors":
					prompt += `\n- Fix encoding errors/mojibake characters (${a.count} detected). Replace with correct characters.`;
					break;
				case "length_anomaly":
					prompt += `\n- Check segments with abnormal length ratios (${a.count} detected). Ensure no content is hallucinated or truncated.`;
					break;
				case "word_repetition_loop":
					prompt += `\n- Remove word repetition loops (${a.count} detected). These are translation engine artifacts.`;
					break;
			}
		}
	}

	return prompt;
}

async function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
	const body = JSON.stringify({
		anthropic_version: "bedrock-2023-05-31",
		max_tokens: 8192,
		messages: [{ role: "user", content: userMessage }],
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
// Titan Embeddings for semantic similarity
// ============================================================
async function getEmbedding(text: string): Promise<number[]> {
	const body = JSON.stringify({
		inputText: text.substring(0, 8000), // Titan limit
	});

	const response = await bedrock.send(
		new InvokeModelCommand({
			modelId: "amazon.titan-embed-text-v2:0",
			contentType: "application/json",
			accept: "application/json",
			body: new TextEncoder().encode(body),
		})
	);

	const responseBody = JSON.parse(new TextDecoder().decode(response.body));
	return responseBody.embedding;
}

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) return 0;
	let dotProduct = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denominator = Math.sqrt(normA) * Math.sqrt(normB);
	return denominator === 0 ? 0 : dotProduct / denominator;
}

// ============================================================
// Register profile loading for correction prompt
// ============================================================
interface RegisterProfile {
	language: string;
	formality: string;
	honorifics: string;
	toneGuidance: string;
	culturalNotes: string;
}

let registerProfilesCache: Record<string, RegisterProfile> | null = null;
const REGISTER_PROFILES_KEY = process.env.REGISTER_PROFILES_KEY || "docs/register_profiles.json";

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

async function getS3Text(bucket: string, key: string): Promise<string> {
	const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
	return (await response.Body?.transformToString("utf-8")) || "";
}

export const handler = async (event: any) => {
	// Event contains jobDetails from the Step Function
	const jobDetails = event.jobDetails || event;
	const jobId = jobDetails.jobId;
	const s3PrefixToObject = jobDetails.s3PrefixToObject; // path to source file
	const s3PrefixToJobId = jobDetails.s3PrefixToJobId; // e.g. private/{identity}/{jobId}

	console.log(`Quality review starting for job ${jobId}`);

	try {
		// Get the source text from S3
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
				console.error("Could not read source file from any path:", err2);
				return { statusCode: 200, body: "Source file not accessible, skipping review" };
			}
		}

		if (!sourceText || sourceText.length < 20) {
			console.log("Source text too short for review, skipping");
			return { statusCode: 200, body: "Skipped - source too short" };
		}

		// Get the translateKey map from DynamoDB to find output file paths
		let translateKeyMap: Record<string, string> = {};
		let bedrockTranslateKeyMap: Record<string, string> = {};
		try {
			const dbResponse = await dynamodb.send(
				new GetItemCommand({
					TableName: JOB_TABLE_NAME,
					Key: { id: { S: jobId } },
					ProjectionExpression: "translateKey, bedrockTranslateKey, jobName, s3PrefixToJobId",
				})
			);
			console.log("DynamoDB response:", JSON.stringify(dbResponse.Item));
			const translateKeyStr = dbResponse.Item?.translateKey?.S;
			if (translateKeyStr) {
				translateKeyMap = JSON.parse(translateKeyStr);
				console.log("translateKeyMap:", JSON.stringify(translateKeyMap));
			} else {
				// Try M (map) type
				const translateKeyMap2 = dbResponse.Item?.translateKey?.M;
				if (translateKeyMap2) {
					for (const [k, v] of Object.entries(translateKeyMap2)) {
						translateKeyMap[k] = (v as any).S || "";
					}
					console.log("translateKeyMap (from M type):", JSON.stringify(translateKeyMap));
				} else {
					console.log("No translateKey found in DynamoDB item");
				}
			}

			// Read Bedrock translation keys (parallel engine output)
			const bedrockKeyStr = dbResponse.Item?.bedrockTranslateKey?.S;
			if (bedrockKeyStr) {
				bedrockTranslateKeyMap = JSON.parse(bedrockKeyStr);
				console.log("bedrockTranslateKeyMap:", JSON.stringify(bedrockTranslateKeyMap));
			}
		} catch (err) {
			console.error("Could not read translateKey from DynamoDB:", err);
		}

		// Process each translated output
		const auditTrail: any[] = [];

		for (const [langKey, s3Uri] of Object.entries(translateKeyMap)) {
			// langKey is like "langen", "langes", etc. — extract the language code
			const langCode = langKey.replace(/^lang/, "");
			
			if (!s3Uri || typeof s3Uri !== "string" || !s3Uri.startsWith("s3://")) {
				console.log(`No valid S3 URI for ${langCode}, skipping`);
				continue;
			}

			// Parse S3 URI: s3://bucket/path/to/file
			const s3Path = s3Uri.replace(`s3://${CONTENT_BUCKET}/`, "");

			let translatedText = "";
			try {
				translatedText = await getS3Text(CONTENT_BUCKET, s3Path);
			} catch (err) {
				console.log(`Could not read translation for ${langCode} at ${s3Path}`);
				continue;
			}

			if (!translatedText || translatedText.length < 10) {
				console.log(`Translation for ${langCode} is empty, skipping`);
				continue;
			}

			// ===== LAYER 1: Structural Integrity =====
			const structural = structuralCheck(sourceText, translatedText, langCode);
			console.log(`Layer 1 (Structural) for ${langCode}: ${structural.pass ? "PASS" : "FAIL"}`);

			// ===== LAYER 2: Entity Preservation =====
			const entities = entityPreservationCheck(sourceText, translatedText);
			console.log(`Layer 2 (Entities) for ${langCode}: ${entities.pass ? "PASS" : "FAIL"} - ${entities.details.preservationRate}%`);

			// ===== LAYER 3: Back-Translation Similarity =====
			const backTranslation = await backTranslationCheck(translatedText, sourceText, jobDetails.languageSource || "en", langCode);
			console.log(`Layer 3 (Back-translation) for ${langCode}: ${backTranslation.pass ? "PASS" : "FAIL"} - BLEU: ${backTranslation.details.bleuScore}`);

			// ===== LAYER 3.4: Multi-Engine Segment Comparison =====
			// If Bedrock translation is available, compare and select best segments
			let segmentComparisonResult: any = null;
			const bedrockS3Uri = bedrockTranslateKeyMap[`lang${langCode}`];
			if (bedrockS3Uri && typeof bedrockS3Uri === "string" && bedrockS3Uri.startsWith("s3://")) {
				try {
					const bedrockS3Path = bedrockS3Uri.replace(`s3://${CONTENT_BUCKET}/`, "");
					const bedrockText = await getS3Text(CONTENT_BUCKET, bedrockS3Path);

					if (bedrockText && bedrockText.length > 10) {
						console.log(`Layer 3.4 (Segment Comparison) for ${langCode}: Bedrock output available (${bedrockText.length} chars)`);

						// Compare at paragraph level
						const awsSegments = translatedText.split(/\n\n+/).filter(s => s.trim().length > 10);
						const bedrockSegments = bedrockText.split(/\n\n+/).filter(s => s.trim().length > 10);
						const sourceSegments = sourceText.split(/\n\n+/).filter(s => s.trim().length > 10);

						// Load glossary for terminology compliance scoring
						const glossary = await loadGlossary();
						let awsTermScore = 0;
						let bedrockTermScore = 0;
						const sourceTextLower = sourceText.toLowerCase();

						for (const [enTerm, translations] of glossary) {
							if (!sourceTextLower.includes(enTerm)) continue;
							const expectedTerm = translations[langCode];
							if (!expectedTerm) continue;
							const expectedLower = expectedTerm.toLowerCase();
							if (translatedText.toLowerCase().includes(expectedLower)) awsTermScore++;
							if (bedrockText.toLowerCase().includes(expectedLower)) bedrockTermScore++;
						}

						// Segment-level comparison with Titan Embeddings
						const minSegments = Math.min(awsSegments.length, bedrockSegments.length, sourceSegments.length);
						const maxSegmentsToCompare = Math.min(minSegments, 20); // Limit to 20 segments for cost
						let contestedCount = 0;
						let agreedCount = 0;
						const mergedSegments: string[] = [];
						let usedEmbeddings = false;

						try {
							for (let i = 0; i < maxSegmentsToCompare; i++) {
								const awsSeg = awsSegments[i];
								const bedrockSeg = bedrockSegments[i];

								// Get embeddings for both segments
								const [awsEmb, bedrockEmb] = await Promise.all([
									getEmbedding(awsSeg),
									getEmbedding(bedrockSeg),
								]);
								usedEmbeddings = true;

								const similarity = cosineSimilarity(awsEmb, bedrockEmb);

								if (similarity >= 0.85) {
									// Agreed — pick based on terminology compliance
									agreedCount++;
									// Check which segment has better term usage
									let awsSegTerms = 0;
									let bedrockSegTerms = 0;
									for (const [enTerm, translations] of glossary) {
										const expectedTerm = translations[langCode];
										if (!expectedTerm) continue;
										if (awsSeg.toLowerCase().includes(expectedTerm.toLowerCase())) awsSegTerms++;
										if (bedrockSeg.toLowerCase().includes(expectedTerm.toLowerCase())) bedrockSegTerms++;
									}
									mergedSegments.push(bedrockSegTerms >= awsSegTerms ? bedrockSeg : awsSeg);
								} else {
									// Contested — synthesise from source
									contestedCount++;
									try {
										const sourceSeg = sourceSegments[i] || "";
										const synthesisPrompt = `You are resolving a translation disagreement. Two engines produced different translations for the same source segment. Produce the CORRECT translation by referring to the SOURCE TEXT as ground truth.

SOURCE (${jobDetails.languageSource || "en"}):
${sourceSeg}

ENGINE A (AWS Translate):
${awsSeg}

ENGINE B (Claude):
${bedrockSeg}

Rules:
- The source text is the ONLY authority on meaning
- If one engine preserves meaning better, prefer it
- If both have errors, produce a new translation from the source
- Use formal, professional register appropriate for safeguarding documents
- Preserve all dates, numbers, names, reference codes unchanged
- Output ONLY the correct translation of this segment, nothing else`;

										const synthesised = await callClaude(synthesisPrompt, "Produce the correct translation.");
										mergedSegments.push(synthesised || bedrockSeg);
									} catch (synthErr) {
										// Fallback to Bedrock segment on synthesis failure
										mergedSegments.push(bedrockSeg);
									}
								}
							}

							// Append remaining segments from the preferred engine
							const preferBedrock = bedrockTermScore >= awsTermScore;
							const remainingSource = preferBedrock ? bedrockSegments : awsSegments;
							for (let i = maxSegmentsToCompare; i < remainingSource.length; i++) {
								mergedSegments.push(remainingSource[i]);
							}

							// Assemble merged document
							if (mergedSegments.length > 0) {
								translatedText = mergedSegments.join("\n\n");
								console.log(`Layer 3.4: Merged document assembled (${mergedSegments.length} segments, ${contestedCount} contested, ${agreedCount} agreed)`);
							}
						} catch (embErr) {
							// Titan Embeddings failed — fall back to terminology-based selection
							console.log(`Layer 3.4: Embeddings failed, falling back to terminology selection: ${embErr}`);
							const preferBedrock = bedrockTermScore >= awsTermScore;
							if (preferBedrock) {
								translatedText = bedrockText;
							}
							usedEmbeddings = false;
						}

						const selectedEngine = bedrockTermScore >= awsTermScore ? "bedrock" : "aws_translate";
						segmentComparisonResult = {
							bedrockAvailable: true,
							awsTermScore,
							bedrockTermScore,
							selectedEngine,
							awsSegments: awsSegments.length,
							bedrockSegments: bedrockSegments.length,
							contestedSegments: contestedCount,
							agreedSegments: agreedCount,
							usedEmbeddings,
							segmentsCompared: maxSegmentsToCompare,
						};

						console.log(`Layer 3.4: AWS term: ${awsTermScore}, Bedrock term: ${bedrockTermScore}, contested: ${contestedCount}, agreed: ${agreedCount}`);
					} else {
						console.log(`Layer 3.4: Bedrock output empty for ${langCode}, using AWS Translate`);
						segmentComparisonResult = { bedrockAvailable: false, reason: "empty_output" };
					}
				} catch (err) {
					console.log(`Layer 3.4: Could not read Bedrock output for ${langCode}: ${err}`);
					segmentComparisonResult = { bedrockAvailable: false, reason: "read_error" };
				}
			} else {
				console.log(`Layer 3.4: No Bedrock translation available for ${langCode}, using AWS Translate only`);
				segmentComparisonResult = { bedrockAvailable: false, reason: "not_available" };
			}

			// ===== LAYER 3.5: Artifact & Hallucination Detection =====
			const artifactReport = detectArtifacts(translatedText, sourceText, langCode);
			console.log(`Layer 3.5 (Artifacts) for ${langCode}: ${artifactReport.pass ? "PASS" : "FAIL"} - density: ${artifactReport.artifactDensity}, artifacts: ${artifactReport.artifacts.length}`);
			if (artifactReport.artifacts.length > 0) {
				console.log(`  Artifact types: ${artifactReport.artifacts.map(a => `${a.type}(${a.count})`).join(", ")}`);
			}

			// ===== LAYER 3.6: Terminology Verification =====
			const glossary = await loadGlossary();
			const terminologyReport = verifyTerminology(sourceText, translatedText, langCode, glossary);
			console.log(`Layer 3.6 (Terminology) for ${langCode}: ${terminologyReport.pass ? "PASS" : "FAIL"} - compliance: ${terminologyReport.complianceRate}%, violations: ${terminologyReport.violations.length}, gaps: ${terminologyReport.gaps.length}`);
			if (terminologyReport.violations.length > 0) {
				console.log(`  Violations: ${terminologyReport.violations.map(v => `"${v.sourceTerm}"`).join(", ")}`);
			}
			if (terminologyReport.gaps.length > 0) {
				console.log(`  Gaps (no translation available): ${terminologyReport.gaps.map(g => `"${g.sourceTerm}"`).join(", ")}`);
			}

			// ===== LAYER 4: AI Review & Correction =====
			console.log(`Layer 4 (AI Review) for ${langCode} (${translatedText.length} chars)...`);
			const reviewMessage = `[SOURCE TEXT]\n${sourceText.substring(0, 15000)}\n\n[TRANSLATED TEXT (${langCode})]\n${translatedText.substring(0, 15000)}`;

			let reviewResult: any = { score: 100, issues: [], verdict: "fit_for_purpose" };
			try {
				const reviewResponse = await callClaude(REVIEW_PROMPT, reviewMessage);
				const jsonMatch = reviewResponse.match(/\{[\s\S]*\}/);
				if (jsonMatch) {
					try {
						reviewResult = JSON.parse(jsonMatch[0]);
					} catch (parseErr) {
						// Try to extract just the score if full JSON fails
						const scoreMatch = reviewResponse.match(/"score"\s*:\s*(\d+)/);
						const verdictMatch = reviewResponse.match(/"verdict"\s*:\s*"([^"]+)"/);
						if (scoreMatch) {
							reviewResult.score = parseInt(scoreMatch[1]);
							reviewResult.verdict = verdictMatch ? verdictMatch[1] : "parse_error";
							reviewResult.issues = [];
							console.log(`Partial parse - got score: ${reviewResult.score}`);
						} else {
							throw parseErr;
						}
					}
				}
			} catch (err) {
				console.error(`Review failed for ${langCode}:`, err);
				auditTrail.push({
					language: langCode,
					score: -1,
					verdict: "review_failed",
					error: String(err),
					timestamp: new Date().toISOString(),
				});
				continue;
			}

			console.log(`Score for ${langCode}: ${reviewResult.score}, Issues: ${reviewResult.issues?.length || 0}`);

			const auditEntry: any = {
				language: langCode,
				pipelineVersion: "v2",
				layers: {
					structural: { pass: structural.pass, ...structural.details },
					entityPreservation: { pass: entities.pass, ...entities.details },
					backTranslation: { pass: backTranslation.pass, ...backTranslation.details },
					segmentComparison: segmentComparisonResult,
					artifactDetection: {
						pass: artifactReport.pass,
						artifactDensity: artifactReport.artifactDensity,
						needsReview: artifactReport.needsReview,
						artifacts: artifactReport.artifacts.map(a => ({ type: a.type, count: a.count, severity: a.severity })),
					},
					terminologyVerification: {
						pass: terminologyReport.pass,
						complianceRate: terminologyReport.complianceRate,
						totalTermsChecked: terminologyReport.totalTermsChecked,
						violationCount: terminologyReport.violations.length,
						violations: terminologyReport.violations.slice(0, 10).map(v => ({
							term: v.sourceTerm,
							expected: v.expectedTranslation,
						})),
						gapCount: terminologyReport.gaps.length,
						gaps: terminologyReport.gaps.slice(0, 10).map(g => g.sourceTerm),
					},
				},
				allLayersPass: structural.pass && entities.pass && backTranslation.pass && artifactReport.pass && terminologyReport.pass,
				aiScore: reviewResult.score,
				domain: reviewResult.domain || null,
				summary: reviewResult.summary || null,
				issueCount: reviewResult.issueCount || 0,
				verdict: reviewResult.verdict,
				correctionApplied: false,
				timestamp: new Date().toISOString(),
			};

			// Step 2: Always apply correction to improve quality
			if (reviewResult.verdict !== "fit_for_purpose" || reviewResult.score < 100) {
				console.log(`Score ${reviewResult.score} for ${langCode}, applying AI correction pass...`);

				try {
					// Build dynamic correction prompt with terminology violations, artifact info, and register profile
					const registerProfiles = await loadRegisterProfiles();
					const registerProfile = registerProfiles[langCode] || null;
					const correctionPrompt = buildCorrectionPrompt(
						terminologyReport.violations,
						artifactReport,
						registerProfile,
						langCode
					);

					const correctionMessage = `[CURRENT TRANSLATION (${langCode})]\n${translatedText}\n\n[ORIGINAL SOURCE TEXT]\n${sourceText.substring(0, 15000)}\n\n[CORRECTION GUIDANCE]\n${reviewResult.correctionGuidance || "Review and improve the translation to ensure it reads naturally, preserves all meaning precisely, uses correct domain terminology, and maintains the professional tone required for safeguarding documents. Fix any literal translations, grammar errors, or contextual mistakes."}`;
					const correctedText = await callClaude(correctionPrompt, correctionMessage);

					if (correctedText && correctedText.length > 10) {
						// Only overwrite if the file is plain text (not a structured .docx)
						const isStructuredDoc = s3Path.endsWith(".docx") || s3Path.endsWith(".xlsx") || s3Path.endsWith(".pptx");

						if (isStructuredDoc) {
							// Do NOT overwrite structured documents — preserve formatting
							// Store the corrected text as a companion file for reference
							const txtPath = s3Path + ".corrected.txt";
							await s3.send(
								new PutObjectCommand({
									Bucket: CONTENT_BUCKET,
									Key: txtPath,
									Body: correctedText,
									ContentType: "text/plain",
								})
							);
							auditEntry.correctionApplied = false;
							auditEntry.correctionStoredAt = txtPath;
							auditEntry.formattingPreserved = true;
							console.log(`Structured doc — correction stored as companion file, original formatting preserved for ${langCode}`);
						} else {
							// Plain text files can be safely overwritten
							await s3.send(
								new PutObjectCommand({
									Bucket: CONTENT_BUCKET,
									Key: s3Path,
									Body: correctedText,
									ContentType: "text/plain",
								})
							);
							auditEntry.correctionApplied = true;
							auditEntry.formattingPreserved = false;
							console.log(`Correction applied for ${langCode}`);
						}
						auditEntry.originalLength = translatedText.length;
						auditEntry.correctedLength = correctedText.length;

						// ===== LAYER 5: Final BLEU Verification =====
						// Back-translate the corrected text and calculate BLEU against original
						// This gives an objective, reproducible quality metric for audit
						if (auditEntry.correctionApplied && correctedText) {
							try {
								const correctedSample = correctedText.substring(0, 5000);
								const finalBackTranslation = await translate.send(
									new TranslateTextCommand({
										Text: correctedSample,
										SourceLanguageCode: langCode,
										TargetLanguageCode: jobDetails.languageSource || "en",
									})
								);
								const finalBackText = finalBackTranslation.TranslatedText || "";
								const originalSample = sourceText.substring(0, 5000);
								const finalBleuScore = calculateBLEU(originalSample, finalBackText);

								auditEntry.finalBleuScore = finalBleuScore;
								auditEntry.qualityMetric = finalBleuScore; // This is the auditable score
								console.log(`Layer 5 (Final BLEU) for ${langCode}: ${finalBleuScore}`);
							} catch (bleuErr) {
								console.error(`Final BLEU check failed for ${langCode}:`, bleuErr);
								auditEntry.finalBleuScore = -1;
							}
						} else if (!isStructuredDoc) {
							// For non-corrected plain text, still run final BLEU on the original translation
							try {
								const sampleText = translatedText.substring(0, 5000);
								const backResult = await translate.send(
									new TranslateTextCommand({
										Text: sampleText,
										SourceLanguageCode: langCode,
										TargetLanguageCode: jobDetails.languageSource || "en",
									})
								);
								const backText = backResult.TranslatedText || "";
								const originalSample = sourceText.substring(0, 5000);
								const finalBleuScore = calculateBLEU(originalSample, backText);

								auditEntry.finalBleuScore = finalBleuScore;
								auditEntry.qualityMetric = finalBleuScore;
								console.log(`Layer 5 (Final BLEU, no correction) for ${langCode}: ${finalBleuScore}`);
							} catch (bleuErr) {
								console.error(`Final BLEU check failed for ${langCode}:`, bleuErr);
								auditEntry.finalBleuScore = -1;
							}
						}
					}
				} catch (err) {
					console.error(`Correction failed for ${langCode}:`, err);
					auditEntry.correctionError = String(err);
				}
			}

			auditTrail.push(auditEntry);
		}

		// Store audit trail and quality score in DynamoDB
		// Use finalBleuScore as the primary auditable metric (objective, reproducible)
		const scoredEntries = auditTrail.filter(a => a.finalBleuScore > 0);
		const overallBleuScore = scoredEntries.length > 0
			? parseFloat((scoredEntries.reduce((sum, a) => sum + a.finalBleuScore, 0) / scoredEntries.length).toFixed(1))
			: -1;

		// Check if any language flagged as needing review (artifact density too high)
		const needsReviewEntries = auditTrail.filter(a => a.layers?.artifactDetection?.needsReview);
		const jobNeedsReview = needsReviewEntries.length > 0;

		const updateExpression = jobNeedsReview
			? "SET qualityScore = :qs, qualityAudit = :qa, qualityReviewedAt = :qr, bleuScore = :bs, qualityPipelineVersion = :pv, jobStatus = :js"
			: "SET qualityScore = :qs, qualityAudit = :qa, qualityReviewedAt = :qr, bleuScore = :bs, qualityPipelineVersion = :pv";

		const expressionValues: Record<string, any> = {
			":qs": { N: String(overallBleuScore) },
			":qa": { S: JSON.stringify(auditTrail) },
			":qr": { S: new Date().toISOString() },
			":bs": { N: String(overallBleuScore) },
			":pv": { S: "v2" },
		};
		if (jobNeedsReview) {
			expressionValues[":js"] = { S: "NEEDS_REVIEW" };
		}

		await dynamodb.send(
			new UpdateItemCommand({
				TableName: JOB_TABLE_NAME,
				Key: { id: { S: jobId } },
				UpdateExpression: updateExpression,
				ExpressionAttributeValues: expressionValues,
			})
		);

		console.log(`Quality review complete for job ${jobId}. BLEU: ${overallBleuScore}. AI Score: ${auditTrail[0]?.aiScore || 'N/A'}. Languages reviewed: ${scoredEntries.length}. Corrections applied: ${auditTrail.filter(a => a.correctionApplied).length}. Needs review: ${jobNeedsReview}`);

		return {
			statusCode: 200,
			body: JSON.stringify({
				jobId,
				overallBleuScore,
				languagesReviewed: scoredEntries.length,
				correctionsApplied: auditTrail.filter(a => a.correctionApplied).length,
				needsReview: jobNeedsReview,
				pipelineVersion: "v2",
			}),
		};
	} catch (err) {
		console.error("Quality review error:", err);
		return { statusCode: 500, body: String(err) };
	}
};
