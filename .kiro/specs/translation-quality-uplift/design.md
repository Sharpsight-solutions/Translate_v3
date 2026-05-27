# Translation Quality Uplift — Design

## Architecture Overview

The uplift extends the existing 5-layer QA pipeline into a **pre-correction enrichment pipeline** that runs between AWS Translate output and the current AI correction step. The new architecture introduces parallel translation, segment-level comparison, and artifact detection.

```
Current Pipeline:
  Upload → AWS Translate (+ terminology) → updateDbStatus → qualityReview (5 layers)

New Pipeline:
  Upload → [Parallel Branch] → Segment Comparison → Artifact Detection → Terminology Verification → AI Correction (register-aware) → Final BLEU
              ├─ AWS Translate (+ terminology)
              └─ Claude Translation (+ terminology + register prompt)
```

## Component Design

### 1. Modified Step Function Flow

**File:** `infrastructure/lib/features/translation/main.ts`

The Step Function chain changes from:
```
mapJobDetails → TranslationTranslate → updateDbStatus → qualityReview
```
To:
```
mapJobDetails → ParallelTranslation → segmentComparison → qualityReview (enhanced)
                 ├─ TranslationTranslate (existing)
                 └─ bedrockTranslation (new Lambda)
```

The `qualityReview` Lambda is enhanced to include artifact detection, terminology verification, and register-aware correction in a single invocation (avoiding multiple Lambda cold starts and S3 round-trips).

### 2. New Lambda: Bedrock Translation

**File:** `infrastructure/lambda/bedrockTranslation/index.ts`

**Purpose:** Translate the source document using Claude 3.7 Sonnet via Bedrock, with terminology and register context.

**Inputs:**
- `jobDetails` (from Step Function state)
- Source text from S3
- Terminology glossary from S3 (`docs/afc_terminology_aws.csv`)
- Register profiles from S3 (`docs/register_profiles.json`)

**Process:**
1. Read source text from S3 (same path as AWS Translate uses)
2. Load terminology glossary for target language
3. Load register profile for target language
4. For each target language, invoke Claude with:
   - System prompt: translation instructions + register guidance
   - User message: source text + terminology table (relevant terms only)
5. Store each translation in S3 at `{s3PrefixToJobId}/bedrock-output/{langCode}/{filename}`
6. Write `bedrockTranslateKey` map to DynamoDB

**Prompt structure:**
```
System: You are a professional translator specialising in UK children's services 
and safeguarding documents. Translate the following document from {sourceLang} to 
{targetLang}.

REGISTER: {registerProfile.description}
- Formality: {registerProfile.formality}
- Honorifics: {registerProfile.honorifics}
- Professional tone: {registerProfile.toneGuidance}

MANDATORY TERMINOLOGY (use these exact translations):
{terminologyTable}

Rules:
- Preserve all dates, numbers, names, reference codes unchanged
- Maintain paragraph structure exactly
- Never translate proper nouns (street names, organisation names)
- Never translate database field labels or reference numbers
- Output ONLY the translated text, no explanations
```

**Timeout:** 10 minutes (large documents with multiple languages)
**Memory:** 512 MB

**IAM:**
- `bedrock:InvokeModel` (Claude 3.7 Sonnet)
- `s3:GetObject` (source text, glossary, register profiles)
- `s3:PutObject` (translated output)
- `dynamodb:UpdateItem` (write bedrockTranslateKey)

### 3. Enhanced Quality Review Lambda

**File:** `infrastructure/lambda/qualityReview/index.ts` (modified)

The existing Lambda is extended with three new phases inserted before the AI correction:

```
Layer 1: Structural Check (existing, unchanged)
Layer 2: Entity Preservation (existing, unchanged)
Layer 3: Back-translation BLEU (existing, unchanged)
--- NEW LAYERS ---
Layer 3.5: Segment Comparison & Selection
Layer 3.6: Artifact Detection
Layer 3.7: Terminology Verification
--- EXISTING LAYERS (enhanced) ---
Layer 4: AI Review & Correction (enhanced with register + terminology violations)
Layer 5: Final BLEU (existing, unchanged)
```

#### Layer 3.5: Segment Comparison & Selection

**Purpose:** Compare AWS Translate output vs Bedrock output segment-by-segment, select best segments.

**Process:**
1. Read both translations from S3 (using `translateKey` and `bedrockTranslateKey`)
2. Split both into segments (paragraph-level)
3. For each segment pair:
   a. Calculate cosine similarity using Titan Embeddings (`amazon.titan-embed-text-v2:0`)
   b. If similarity >= 0.85: select the segment with better terminology compliance
   c. If similarity < 0.85 (contested): invoke Claude synthesis prompt
4. Assemble final merged document from selected/synthesised segments
5. Store merged document in S3 (replaces the AWS Translate output path)

**Synthesis prompt (for contested segments):**
```
You are resolving a translation disagreement. Two engines produced different 
translations for the same source segment. Your job is to produce the CORRECT 
translation by referring to the SOURCE TEXT as ground truth.

SOURCE ({sourceLang}): {sourceSegment}
ENGINE A (AWS Translate): {awsSegment}
ENGINE B (Claude): {bedrockSegment}

MANDATORY TERMINOLOGY: {relevantTerms}

Rules:
- The source text is the ONLY authority on meaning
- If one engine preserves meaning better, prefer it
- If both have errors, produce a new translation from the source
- Use the mandatory terminology exactly as specified
- Output ONLY the correct translation of this segment
```

**Fallback:** If Bedrock translation failed (no `bedrockTranslateKey`), skip comparison and proceed with AWS Translate output only (graceful degradation).

#### Layer 3.6: Artifact Detection

**Purpose:** Detect and flag translation artifacts before AI correction.

**Implementation (pure heuristic, zero API cost):**
```typescript
function detectArtifacts(translatedText: string, sourceText: string, targetLang: string): ArtifactReport {
  const artifacts: Artifact[] = [];
  
  // 1. Untranslated English fragments (if target != en)
  if (targetLang !== "en") {
    const englishPattern = /\b(the|is|are|was|were|have|has|been|will|would|should|could|this|that|these|those|which|where|when|because|however|therefore|although)\b/gi;
    const matches = translatedText.match(englishPattern) || [];
    if (matches.length > 5) {
      artifacts.push({ type: "untranslated_fragments", count: matches.length, severity: "high" });
    }
  }
  
  // 2. Repeated phrases (hallucination indicator)
  const sentences = translatedText.split(/[.!?]+/);
  const seen = new Map<string, number>();
  for (const s of sentences) {
    const normalized = s.trim().toLowerCase();
    if (normalized.length > 20) {
      seen.set(normalized, (seen.get(normalized) || 0) + 1);
    }
  }
  const repeats = [...seen.entries()].filter(([_, count]) => count > 3);
  if (repeats.length > 0) {
    artifacts.push({ type: "repeated_phrases", count: repeats.length, severity: "high" });
  }
  
  // 3. Encoding artifacts (mojibake)
  const mojibakePattern = /[ÃƒÂ¢â‚¬â„¢Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â]/g;
  const mojibakeMatches = translatedText.match(mojibakePattern) || [];
  if (mojibakeMatches.length > 3) {
    artifacts.push({ type: "encoding_errors", count: mojibakeMatches.length, severity: "medium" });
  }
  
  // 4. Length anomaly per segment
  const sourceSegments = sourceText.split(/\n\n+/);
  const targetSegments = translatedText.split(/\n\n+/);
  let anomalies = 0;
  for (let i = 0; i < Math.min(sourceSegments.length, targetSegments.length); i++) {
    const ratio = targetSegments[i].length / Math.max(sourceSegments[i].length, 1);
    if (ratio > 2.5 || ratio < 0.3) anomalies++;
  }
  if (anomalies > 0) {
    artifacts.push({ type: "length_anomaly", count: anomalies, severity: "medium" });
  }
  
  const totalSegments = Math.max(sourceSegments.length, 1);
  const artifactDensity = artifacts.reduce((sum, a) => sum + a.count, 0) / totalSegments;
  
  return {
    artifacts,
    artifactDensity,
    needsReview: artifactDensity > 0.1,
    pass: artifactDensity <= 0.1,
  };
}
```

#### Layer 3.7: Terminology Verification

**Purpose:** Check the merged translation against the glossary and generate correction instructions.

**Process:**
1. Load glossary CSV from S3
2. For each term in the glossary where source language matches:
   a. Check if the source text contains the English term
   b. If yes, check if the translated text contains the correct target-language term
   c. If the correct term is missing, flag as a terminology violation
3. Generate correction instructions for Layer 4
4. Log any terms where the target language column is empty (gap detection)

**Output:** `terminologyViolations[]` array passed to Layer 4 prompt.

#### Enhanced Layer 4: Register-Aware AI Correction

The existing correction prompt is enhanced with:
1. Register profile for the target language
2. Explicit terminology violation corrections from Layer 3.7
3. Artifact removal instructions from Layer 3.6

**Enhanced correction prompt structure:**
```
You are an expert translator specialising in UK children's services and safeguarding 
documents. The following translation has quality issues. Apply corrections.

REGISTER REQUIREMENTS ({targetLang}):
{registerProfile}

TERMINOLOGY CORRECTIONS REQUIRED:
{terminologyViolations.map(v => `- Replace "${v.found}" with "${v.correct}" (term: ${v.sourceTerm})`)}

ARTIFACTS TO REMOVE:
{artifactReport.artifacts.map(a => `- ${a.type}: ${a.count} instances detected`)}

[KNOWN FAILURE PATTERNS]
{existingKnownFailures}

Rules:
- Fix all terminology violations listed above — these are NON-NEGOTIABLE
- Remove any untranslated English fragments
- Remove any repeated/hallucinated content
- Maintain the register described above throughout
- Preserve all dates, numbers, names, reference codes unchanged
- Output ONLY the corrected full translation text
```

### 4. Register Profiles Configuration

**File:** `docs/register_profiles.json`

```json
{
  "sq": {
    "language": "Albanian",
    "formality": "formal",
    "honorifics": "Use formal 'ju' (you-plural/formal) when addressing families",
    "toneGuidance": "Professional, respectful. Albanian social work documents use formal register throughout. Avoid colloquialisms.",
    "culturalNotes": "Albanian readers expect formal institutional language. Direct address should use polite forms."
  },
  "ar": {
    "language": "Arabic",
    "formality": "formal",
    "honorifics": "Use formal address forms. Include appropriate honorifics for parents.",
    "toneGuidance": "Formal Modern Standard Arabic (MSA) for official documents. Avoid dialectal forms.",
    "culturalNotes": "Right-to-left text. Formal register expected for government/legal documents."
  },
  "ta": {
    "language": "Tamil",
    "formality": "formal",
    "honorifics": "Use respectful suffix '-kal' for plural/formal address",
    "toneGuidance": "Formal written Tamil (centamil where appropriate). Professional institutional tone.",
    "culturalNotes": "Tamil has distinct formal/informal registers. Official documents require formal register."
  },
  "fa": {
    "language": "Farsi/Persian",
    "formality": "formal",
    "honorifics": "Use formal 'shomā' (شما) for address. Include appropriate titles.",
    "toneGuidance": "Formal written Farsi. Professional and respectful tone appropriate for legal/social care context.",
    "culturalNotes": "Persian formal register is expected for institutional communications."
  },
  "es": {
    "language": "Spanish",
    "formality": "formal",
    "honorifics": "Use 'usted' (formal you) throughout. Never use 'tú' in official documents.",
    "toneGuidance": "Formal institutional Spanish. European Spanish conventions unless family origin indicates Latin American.",
    "culturalNotes": "Safeguarding terminology varies between Spain and Latin America. Default to European Spanish."
  },
  "ur": {
    "language": "Urdu",
    "formality": "formal",
    "honorifics": "Use 'āp' (آپ) for formal address. Include respectful forms for parents.",
    "toneGuidance": "Formal written Urdu appropriate for official government documents.",
    "culturalNotes": "Right-to-left script. Formal register with appropriate Urdu vocabulary (avoid excessive Arabic/Persian loanwords where Urdu equivalents exist)."
  },
  "fr": {
    "language": "French",
    "formality": "formal",
    "honorifics": "Use 'vous' throughout. Never use 'tu' in official documents.",
    "toneGuidance": "Formal administrative French. Professional tone consistent with French social services documentation.",
    "culturalNotes": "French institutional language has specific conventions. Use passive constructions where appropriate for professional distance."
  },
  "pt": {
    "language": "Portuguese",
    "formality": "formal",
    "honorifics": "Use formal 'o senhor/a senhora' or 'você' (formal context). Avoid 'tu'.",
    "toneGuidance": "Formal European Portuguese for official documents.",
    "culturalNotes": "Default to European Portuguese unless family origin indicates Brazilian Portuguese."
  },
  "so": {
    "language": "Somali",
    "formality": "formal",
    "honorifics": "Use respectful address forms appropriate for official communications.",
    "toneGuidance": "Formal written Somali. Clear, professional language accessible to readers with varying literacy levels.",
    "culturalNotes": "Somali has limited standardised terminology for social work concepts. Use clear explanatory language where direct equivalents don't exist."
  },
  "tr": {
    "language": "Turkish",
    "formality": "formal",
    "honorifics": "Use 'siz' (formal you) throughout. Include 'Bey/Hanım' where appropriate.",
    "toneGuidance": "Formal institutional Turkish consistent with official government communications.",
    "culturalNotes": "Turkish formal register is well-defined. Use standard institutional language."
  }
}
```

### 5. DynamoDB Schema Extensions

**New fields on job table:**

| Field | Type | Description |
|-------|------|-------------|
| `bedrockTranslateKey` | Map (S) | S3 paths to Bedrock translation outputs per language |
| `segmentComparison` | String (JSON) | Comparison results: contested count, resolution method |
| `artifactReport` | String (JSON) | Artifact detection results per language |
| `terminologyViolations` | String (JSON) | Terms that failed verification per language |
| `qualityPipelineVersion` | String | "v2" to distinguish from v1 pipeline results |

### 6. CDK Infrastructure Changes

**File:** `infrastructure/lib/features/translation/main.ts`

```typescript
// New: Bedrock Translation Lambda
const bedrockTranslationLambda = new dt_lambda(this, "bedrockTranslationLambda", {
    path: "lambda/bedrockTranslation",
    description: "Parallel translation via Claude 3.7 Sonnet",
    environment: {
        JOB_TABLE_NAME: props.jobTable.tableName,
        CONTENT_BUCKET: props.contentBucket.bucketName,
        GLOSSARY_KEY: "docs/afc_terminology_aws.csv",
        REGISTER_PROFILES_KEY: "docs/register_profiles.json",
    },
    timeout: cdk.Duration.minutes(10),
    memorySize: 512,
});

// Parallel branch: AWS Translate + Bedrock Translation
const parallelTranslation = new sfn.Parallel(this, "parallelTranslation", {
    resultPath: "$.translationResults",
})
    .branch(startSfnTranslate)  // existing AWS Translate step function
    .branch(invokeBedrockTranslation);  // new Bedrock translation

// Updated chain:
// mapJobDetails → parallelTranslation → updateDbStatus → qualityReview (enhanced)
```

**Quality Review Lambda changes:**
- Memory increased to 1024 MB (segment comparison with embeddings)
- Additional IAM: `bedrock:InvokeModel` for Titan Embeddings
- Environment variable: `GLOSSARY_KEY`, `REGISTER_PROFILES_KEY`

### 7. Cost Analysis

| Component | Cost per job (est.) | Notes |
|-----------|-------------------|-------|
| AWS Translate | $0.075 | Existing (5000 words × $15/M chars) |
| Claude Translation | $0.15 | ~5000 words input + output @ Sonnet pricing |
| Titan Embeddings | $0.02 | ~50 segments × $0.0004/segment |
| Claude Synthesis (contested) | $0.05 | ~10 contested segments average |
| Claude Correction | $0.10 | Existing (enhanced prompt, similar cost) |
| **Total per job** | **~$0.40** | Up from ~$0.18 (current) |

**Monthly estimate (50 jobs/month):** ~$20/month (up from ~$9/month)

### 8. Failure Modes & Graceful Degradation

| Failure | Behaviour |
|---------|-----------|
| Bedrock Translation Lambda timeout | Pipeline continues with AWS Translate output only |
| Titan Embeddings unavailable | Skip segment comparison, use AWS Translate output |
| Glossary file missing from S3 | Skip terminology verification, log warning |
| Register profiles missing | Default to generic "formal professional" prompt |
| Artifact density > 10% | Flag job as `needs_review`, still deliver AWS Translate output |
| All new layers fail | Fall back to existing v1 pipeline behaviour (no regression) |

### 9. Testing Strategy

1. **Unit tests:** Artifact detection regex patterns, terminology matching logic, BLEU calculation
2. **Integration test:** Submit a known safeguarding document, verify both engines produce output
3. **Quality regression:** Re-run the Luigi & Vittoria Fabiani document, compare score against 64/100 baseline
4. **Cost monitoring:** CloudWatch metric for Bedrock invocation costs per job

### 10. Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `infrastructure/lambda/bedrockTranslation/index.ts` | CREATE | New parallel translation Lambda |
| `infrastructure/lambda/qualityReview/index.ts` | MODIFY | Add layers 3.5, 3.6, 3.7; enhance Layer 4 |
| `infrastructure/lib/features/translation/main.ts` | MODIFY | Add parallel branch, new Lambda construct |
| `docs/register_profiles.json` | CREATE | Register profiles for 10 languages |
| `docs/afc_terminology_aws.csv` | EXISTING | Already deployed, read by new Lambdas |
