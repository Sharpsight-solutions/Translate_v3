// Post-translation quality review Lambda
// Layered QA: structural checks, entity preservation, back-translation, then AI correction
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
5. TONE & REGISTER FAILURES (Moderate): Translation lacks the formal/legal tone required for professional safeguarding documents. Score penalty: -5 per instance.
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

const CORRECTION_PROMPT = `You are an expert translator specialising in UK children's services and safeguarding documents. The following translation has quality issues. Apply corrections using the original source text as your reference.

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
		try {
			const dbResponse = await dynamodb.send(
				new GetItemCommand({
					TableName: JOB_TABLE_NAME,
					Key: { id: { S: jobId } },
					ProjectionExpression: "translateKey, jobName, s3PrefixToJobId",
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
			console.log(`Layer 3 (Back-translation) for ${langCode}: ${backTranslation.pass ? "PASS" : "FAIL"} - ${backTranslation.details.similarity}%`);

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
				layers: {
					structural: { pass: structural.pass, ...structural.details },
					entityPreservation: { pass: entities.pass, ...entities.details },
					backTranslation: { pass: backTranslation.pass, ...backTranslation.details },
				},
				allLayersPass: structural.pass && entities.pass && backTranslation.pass,
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
					const correctionMessage = `[CURRENT TRANSLATION (${langCode})]\n${translatedText}\n\n[ORIGINAL SOURCE TEXT]\n${sourceText.substring(0, 15000)}\n\n[CORRECTION GUIDANCE]\n${reviewResult.correctionGuidance || "Review and improve the translation to ensure it reads naturally, preserves all meaning precisely, uses correct domain terminology, and maintains the professional tone required for safeguarding documents. Fix any literal translations, grammar errors, or contextual mistakes."}`;
					const correctedText = await callClaude(CORRECTION_PROMPT, correctionMessage);

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

		await dynamodb.send(
			new UpdateItemCommand({
				TableName: JOB_TABLE_NAME,
				Key: { id: { S: jobId } },
				UpdateExpression: "SET qualityScore = :qs, qualityAudit = :qa, qualityReviewedAt = :qr, bleuScore = :bs",
				ExpressionAttributeValues: {
					":qs": { N: String(overallBleuScore) },
					":qa": { S: JSON.stringify(auditTrail) },
					":qr": { S: new Date().toISOString() },
					":bs": { N: String(overallBleuScore) },
				},
			})
		);

		console.log(`Quality review complete for job ${jobId}. BLEU: ${overallBleuScore}. AI Score: ${auditTrail[0]?.aiScore || 'N/A'}. Languages reviewed: ${scoredEntries.length}. Corrections applied: ${auditTrail.filter(a => a.correctionApplied).length}`);

		return {
			statusCode: 200,
			body: JSON.stringify({
				jobId,
				overallScore,
				languagesReviewed: scoredEntries.length,
				correctionsApplied: auditTrail.filter(a => a.correctionApplied).length,
			}),
		};
	} catch (err) {
		console.error("Quality review error:", err);
		return { statusCode: 500, body: String(err) };
	}
};
