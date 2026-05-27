# Technical Quality Control Specification
## Document Transformation Service â€” Translation Pipeline QA

**Organisation:** Achieving for Children  
**Repository:** `Sharpsight-solutions/Translate_v3`  
**Version:** 2.0  
**Date:** May 2026  
**Purpose:** Independent technical review of quality assurance implementation  

---

## 1. Scope

This document provides a technical specification of the quality assurance mechanisms implemented in the translation pipeline. It is intended for an independent technical reviewer to verify against the source code in the repository.

**Files to review:**
- `infrastructure/lambda/qualityReview/index.ts` â€” QA Lambda implementation (v2 pipeline)
- `infrastructure/lambda/bedrockTranslation/index.ts` â€” Parallel Claude translation engine
- `infrastructure/lib/features/translation/main.ts` â€” Step Function integration
- `infrastructure/lib/features/translation/pdfAndWordCount.ts` â€” S3 trigger Lambdas
- `infrastructure/lib/features/translation/translate.ts` â€” AWS Translate Step Function
- `infrastructure/lib/features/translation/translation.ts` â€” GraphQL schema & DynamoDB
- `docs/afc_terminology_aws.csv` â€” Custom terminology glossary
- `docs/register_profiles.json` â€” Language register profiles (10 languages)

---

## 2. Pipeline Architecture (v2)

### 2.1 Execution Flow

```
S3 ObjectCreated (upload)
    â”‚
    â”œâ”€â†’ pdfConversion Lambda (if .pdf suffix)
    â”‚       Extract text via pdf-parse or Textract
    â”‚
    â”œâ”€â†’ wordCount Lambda (if .txt/.docx/.html/.xlsx suffix)
    â”‚
    â””â”€â†’ DynamoDB Stream (INSERT, jobStatus=UPLOADED)
            â”‚
            â–¼
        EventBridge Pipe â†’ Step Function (TranslationMainRename)
            â”‚
            â–¼
        Step Function (TranslationMain)
            â”‚
            â”œâ”€â†’ mapJobDetails (Pass state)
            â”œâ”€â†’ PARALLEL BRANCH:
            â”‚     â”œâ”€ Branch 1: TranslationTranslate (AWS Translate + custom terminology)
            â”‚     â”œâ”€ Branch 2: bedrockTranslation Lambda (Claude 3.7 Sonnet + register + terminology)
            â”‚     â””â”€ Branch 3: PII detection (if enabled)
            â”œâ”€â†’ updateDbJobStatus (COMPLETED)
            â””â”€â†’ qualityReview Lambda (MANDATORY, v2 pipeline)
                    8 quality layers (see Section 3)
```

### 2.2 Multi-Engine Translation (NEW in v2)

**Parallel execution:** Both AWS Translate and Claude 3.7 Sonnet translate the document simultaneously. The Step Function uses `sfn.Parallel` to run both branches concurrently.

**Graceful degradation:** The Bedrock translation branch has error handling (`addCatch` with `States.ALL`). If Claude fails (timeout, throttling, etc.), the pipeline continues with AWS Translate output only.

**File:** `infrastructure/lambda/bedrockTranslation/index.ts`
- Timeout: 15 minutes
- Memory: 1024 MB
- Model: `anthropic.claude-3-7-sonnet-20250219-v1:0`
- Inputs: source text, terminology glossary, register profiles
- Output: translations stored at `{s3PrefixToJobId}/bedrock-output/{langCode}/{filename}`
- DynamoDB: writes `bedrockTranslateKey` map

---

## 3. Quality Assurance Layers (v2)

### 3.1 Layer 1: Structural Integrity Check (free, instant)

Unchanged from v1. Checks paragraph count ratio, length ratio, non-empty validation.

### 3.2 Layer 2: Entity Preservation Check (free, instant)

Unchanged from v1. Verifies dates, numbers, emails are preserved in translation.

### 3.3 Layer 3: Back-Translation with BLEU Score

Unchanged from v1. Back-translates via AWS Translate, calculates BLEU score.

### 3.4 Layer 3.4: Multi-Engine Segment Comparison (NEW)

**Purpose:** Compare AWS Translate and Bedrock outputs segment-by-segment using semantic similarity, then select or synthesise the best translation.

**Process:**
1. Read both translations from S3 (`translateKey` and `bedrockTranslateKey`)
2. Split into paragraph-level segments
3. For each segment pair (up to 20 segments):
   a. Generate embeddings via Amazon Titan Embed Text v2 (`amazon.titan-embed-text-v2:0`)
   b. Calculate cosine similarity between the two engine outputs
   c. If similarity >= 0.85 ("agreed"): select segment with better terminology compliance
   d. If similarity < 0.85 ("contested"): invoke Claude synthesis prompt
4. Assemble merged document from selected/synthesised segments
5. Store comparison metadata in audit trail

**Synthesis prompt** (for contested segments):
- Receives: source segment, AWS Translate output, Bedrock output
- Instruction: ground decision in source meaning, use mandatory terminology
- Output: correct translation of the contested segment

**Fallback chain:**
- If `bedrockTranslateKey` missing â†’ use AWS Translate only
- If Titan Embeddings fails â†’ fall back to terminology-based selection
- If synthesis fails for a segment â†’ use Bedrock segment

### 3.5 Layer 3.5: Artifact & Hallucination Detection (NEW, free, instant)

**Purpose:** Detect translation artifacts before AI correction.

**Detections:**
| Type | Pattern | Severity |
|------|---------|----------|
| Untranslated fragments | English function words in non-English output (>8 instances) | High |
| Repeated phrases | Identical sentences appearing >3 times | High |
| Word repetition loops | Same word repeated 4+ times consecutively | High |
| Encoding errors | Mojibake patterns (UTF-8 corruption) | Medium |
| Length anomalies | Segments >2.5x or <0.3x source length | Medium |

**Threshold:** If artifact density > 10% of segments, job flagged as `NEEDS_REVIEW`.

### 3.6 Layer 3.6: Terminology Verification (NEW, free after S3 load)

**Purpose:** Verify glossary compliance and generate correction instructions.

**Process:**
1. Load `afc_terminology_aws.csv` from S3 (cached in Lambda memory)
2. For each English term found in source text:
   - Check if correct target-language translation appears in output
   - If missing: record as violation
   - If no translation exists for target language: record as gap
3. Pass violations to Layer 4 as non-negotiable correction instructions
4. Log gaps for admin review

**Output:** `TerminologyReport` with compliance rate, violations, and gaps.

### 3.7 Layer 4: AI Review & Correction (ENHANCED)

**Enhancements over v1:**
- **Register-aware:** Correction prompt includes language-specific register requirements (formality, honorifics, tone)
- **Terminology-enforced:** Violations from Layer 3.6 listed as "NON-NEGOTIABLE" corrections
- **Artifact-aware:** Specific removal instructions for detected artifacts
- **Review prompt enhanced:** Register violations now penalised (-5 per instance) with specific examples (tu/vous, tÃº/usted, sen/siz)

**Dynamic prompt construction:**
```typescript
buildCorrectionPrompt(terminologyViolations, artifactReport, registerProfile, targetLang)
```

### 3.8 Layer 5: Final BLEU Verification

Unchanged from v1. Back-translates corrected text, calculates BLEU against original. This remains the primary auditable metric.

---

## 4. Register Profiles

**File:** `docs/register_profiles.json`

**Languages covered:** Albanian, Arabic, Tamil, Farsi, Spanish, Urdu, French, Portuguese, Somali, Turkish

**Profile structure:**
```json
{
  "formality": "formal",
  "honorifics": "Use 'vous' throughout. Never use 'tu'.",
  "toneGuidance": "Formal administrative French...",
  "culturalNotes": "French institutional language has specific conventions..."
}
```

**Integration points:**
- Bedrock Translation Lambda: included in translation system prompt
- Quality Review Lambda: included in correction prompt
- Review scoring: register violations penalised

---

## 5. Custom Terminology

**File:** `docs/afc_terminology_aws.csv`

**Deployment:** Uploaded to S3 content bucket via CDK `BucketDeployment` construct. Also registered as AWS Translate custom terminology resource.

**Dual usage:**
1. AWS Translate applies it natively via `TerminologyNames` parameter
2. Bedrock Translation Lambda injects relevant terms into Claude prompt
3. Quality Review Lambda verifies compliance post-translation

---

## 6. DynamoDB Schema (Quality Fields)

| Field | Type | Description |
|-------|------|-------------|
| `qualityScore` | Number | Final BLEU score (primary audit metric) |
| `bleuScore` | Number | Same as qualityScore (explicit field for queries) |
| `qualityAudit` | String (JSON) | Full audit trail per language |
| `qualityReviewedAt` | String (ISO 8601) | Timestamp of review completion |
| `qualityPipelineVersion` | String | "v2" for new pipeline |
| `bedrockTranslateKey` | String (JSON) | S3 paths to Bedrock translation outputs |

**Audit trail JSON structure (v2):**
```json
{
  "language": "it",
  "pipelineVersion": "v2",
  "layers": {
    "structural": { "pass": true, ... },
    "entityPreservation": { "pass": true, ... },
    "backTranslation": { "pass": true, "bleuScore": 22.4, ... },
    "segmentComparison": {
      "bedrockAvailable": true,
      "awsTermScore": 8,
      "bedrockTermScore": 12,
      "selectedEngine": "bedrock",
      "contestedSegments": 3,
      "agreedSegments": 17,
      "usedEmbeddings": true
    },
    "artifactDetection": {
      "pass": true,
      "artifactDensity": 0.02,
      "needsReview": false,
      "artifacts": []
    },
    "terminologyVerification": {
      "pass": false,
      "complianceRate": 85.7,
      "totalTermsChecked": 7,
      "violationCount": 1,
      "violations": [{ "term": "coaching", "expected": "condizionamento" }],
      "gapCount": 0
    }
  },
  "allLayersPass": false,
  "aiScore": 78,
  "verdict": "needs_correction",
  "correctionApplied": true,
  "finalBleuScore": 32.1,
  "qualityMetric": 32.1
}
```

---

## 7. Formatting Preservation

Unchanged from v1. Structured documents (.docx, .xlsx, .pptx) are never overwritten. AI corrections stored as companion `.corrected.txt` files.

---

## 8. Error Handling & Graceful Degradation

| Failure | Behaviour |
|---------|-----------|
| Bedrock Translation Lambda timeout | Pipeline continues with AWS Translate only |
| Titan Embeddings unavailable | Skip segment comparison, use terminology-based selection |
| Glossary file missing from S3 | Skip terminology verification, log warning |
| Register profiles missing | Default to generic "formal professional" prompt |
| Artifact density > 10% | Flag job as `NEEDS_REVIEW`, still deliver translation |
| Quality review Lambda failure | Pipeline completes, user gets AWS Translate output |
| Claude synthesis fails for segment | Fall back to Bedrock segment |
| All new layers fail | Fall back to v1 pipeline behaviour (no regression) |

---

## 9. Security & Data Residency

| Aspect | Implementation |
|--------|---------------|
| Region lock | All services in `eu-west-2` |
| Bedrock region | Lambda env `AWS_REGION` = eu-west-2 |
| No model training | Amazon Bedrock default policy |
| S3 encryption | `BucketEncryption.S3_MANAGED` |
| S3 SSL enforcement | `enforceSSL: true` |
| Document lifecycle | 7-day expiration on content bucket |
| IAM least privilege | Scoped policies per Lambda |
| Titan Embeddings | Data not stored, not used for training |

---

## 10. Verification Procedure for Reviewer

### 10.1 Confirm parallel translation architecture

1. Open `infrastructure/lib/features/translation/main.ts`
2. Verify `bedrockTranslationLambda` is instantiated with path `lambda/bedrockTranslation`
3. Verify `invokeBedrockTranslation` has `addCatch` for graceful degradation
4. Verify `sfn.Parallel` includes both `startSfnTranslate` and `invokeBedrockTranslation`

### 10.2 Confirm all 8 layers execute in quality review

1. Open `infrastructure/lambda/qualityReview/index.ts`
2. Verify Layer 1: `structuralCheck()` called
3. Verify Layer 2: `entityPreservationCheck()` called
4. Verify Layer 3: `backTranslationCheck()` with BLEU calculation
5. Verify Layer 3.4: `bedrockTranslateKeyMap` read, Titan Embeddings called, synthesis for contested segments
6. Verify Layer 3.5: `detectArtifacts()` called
7. Verify Layer 3.6: `verifyTerminology()` called with glossary from S3
8. Verify Layer 4: `buildCorrectionPrompt()` includes register, terminology, artifacts
9. Verify Layer 5: Final BLEU calculation after correction

### 10.3 Confirm register-aware prompting

1. Open `docs/register_profiles.json` â€” verify 10 language profiles
2. Open `infrastructure/lambda/bedrockTranslation/index.ts` â€” verify `loadRegisterProfiles()` and inclusion in prompt
3. Open `infrastructure/lambda/qualityReview/index.ts` â€” verify `loadRegisterProfiles()` in correction prompt

### 10.4 Confirm terminology enforcement

1. Verify `afc_terminology_aws.csv` deployed to S3 via `BucketDeployment`
2. Verify `verifyTerminology()` checks source terms against translated output
3. Verify violations passed to correction prompt as "NON-NEGOTIABLE"
4. Verify gap detection logs terms with no target language translation

### 10.5 Confirm BLEU remains primary metric

1. Verify `finalBleuScore` calculated AFTER correction
2. Verify `qualityScore` in DynamoDB set to BLEU value (not AI score)
3. Verify `qualityPipelineVersion: "v2"` written to distinguish from legacy

---

## 11. Cost Analysis (v2 Pipeline)

| Component | Cost per job | Notes |
|-----------|-------------|-------|
| AWS Translate batch | ~$0.075 | 5000 words Ã— $15/M chars |
| Claude Translation (parallel) | ~$0.15 | ~5000 words, Sonnet pricing |
| Titan Embeddings | ~$0.02 | ~20 segments Ã— $0.001/segment |
| Claude Synthesis (contested) | ~$0.05 | ~3-5 contested segments avg |
| Claude Review + Correction | ~$0.10 | Enhanced prompt, similar to v1 |
| Back-translation (AWS Translate) | ~$0.01 | 5000 char samples |
| **Total per job** | **~$0.40** | Up from ~$0.18 (v1) |

**Monthly estimate (50 jobs/month):** ~$20/month

---

## 12. Known Technical Debt

| Item | Risk | Notes |
|------|------|-------|
| Lambda timeout (15 min) may be insufficient for 10+ target languages | Medium | Monitor CloudWatch |
| Segment comparison limited to 20 segments | Low | Sufficient for quality signal |
| Titan Embeddings adds ~$0.02/job cost | Low | Negligible vs quality gain |
| Register profiles are static JSON | Low | Update requires S3 re-upload |
| Glossary CSV format limits complex terms | Medium | Consider JSON format for v3 |
| No HITL for NEEDS_REVIEW jobs | Medium | Out of scope per requirements |

---

*End of specification.*

