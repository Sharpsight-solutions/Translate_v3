# Technical Quality Control Specification
## Document Transformation Service — Translation Pipeline QA

**Organisation:** Achieving for Children  
**Repository:** `aws-samples/document-translation` (forked)  
**Version:** 1.0  
**Date:** May 2026  
**Purpose:** Independent technical review of quality assurance implementation  

---

## 1. Scope

This document provides a technical specification of the quality assurance mechanisms implemented in the translation pipeline. It is intended for an independent technical reviewer to verify against the source code in the repository.

**Files to review:**
- `infrastructure/lambda/qualityReview/index.ts` — QA Lambda implementation
- `infrastructure/lib/features/translation/main.ts` — Step Function integration
- `infrastructure/lib/features/translation/pdfAndWordCount.ts` — S3 trigger Lambdas
- `infrastructure/lib/features/translation/translate.ts` — AWS Translate Step Function
- `infrastructure/lib/features/translation/translation.ts` — GraphQL schema & DynamoDB
- `docs/afc_terminology_aws.csv` — Custom terminology glossary

---

## 2. Pipeline Architecture

### 2.1 Execution Flow

```
S3 ObjectCreated (upload)
    │
    ├─→ pdfConversion Lambda (if .pdf suffix)
    │       File: infrastructure/lambda/pdfConversion/index.ts
    │       Trigger: S3 event notification, suffix filter ".pdf"
    │       Action: Extract text via pdf-parse (born-digital) or Textract (scanned)
    │       Output: .txt file written to same S3 prefix, .pdf deleted
    │
    ├─→ wordCount Lambda (if .txt/.docx/.html/.xlsx suffix)
    │       File: infrastructure/lambda/wordCount/index.ts
    │       Trigger: S3 event notification, suffix filters
    │       Action: Count words, write to DynamoDB job record
    │
    └─→ DynamoDB Stream (INSERT, jobStatus=UPLOADED)
            │
            ▼
        EventBridge Pipe → Step Function (TranslationMainRename)
            │
            ▼
        Step Function (TranslationMain)
            │
            ├─→ mapJobDetails (Pass state)
            ├─→ TranslationTranslate (nested Step Function)
            │       - Loops target languages
            │       - Applies custom terminology (afc-safeguarding)
            │       - Calls AWS Translate StartTextTranslationJob
            │       - Waits for completion via EventBridge resume
            │       - Writes translateKey to DynamoDB
            ├─→ updateDbJobStatus (DynamoDB: jobStatus=COMPLETED, completedAt)
            └─→ qualityReview Lambda (MANDATORY)
                    File: infrastructure/lambda/qualityReview/index.ts
                    Timeout: 15 minutes
                    Action: 5-layer QA (see Section 3)
```

### 2.2 CDK Construct Wiring

**File:** `infrastructure/lib/features/translation/main.ts`

```typescript
// Quality review Lambda instantiation (line ~155)
const qualityReviewLambda = new dt_lambda(this, "qualityReviewLambda", {
    path: "lambda/qualityReview",
    description: "Post-translation AI quality review and correction",
    environment: {
        JOB_TABLE_NAME: props.jobTable.tableName,
        CONTENT_BUCKET: props.contentBucket.bucketName,
    },
    timeout: cdk.Duration.minutes(15),
});

// Step Function chain (line ~220)
// definition: ... .next(updateDbJobStatus).next(invokeQualityReview)
```

**IAM Permissions granted:**
- `s3:GetObject`, `s3:PutObject` on content bucket
- `dynamodb:GetItem`, `dynamodb:UpdateItem` on job table
- `bedrock:InvokeModel` (all resources)
- `translate:TranslateText` (all resources)

---

## 3. Quality Assurance Layers

### 3.1 Layer 1: Structural Integrity Check

**Location:** `infrastructure/lambda/qualityReview/index.ts`, function `structuralCheck()`

**Implementation:**
```typescript
function structuralCheck(sourceText: string, translatedText: string, targetLang: string) {
    // Paragraph count comparison (30% tolerance)
    // Length ratio check (0.5x – 2.0x bounds)
    // Non-empty validation (>10 chars)
    return { pass: boolean, details: {...} };
}
```

**Pass criteria:**
- `notEmpty`: `translatedText.trim().length > 10`
- `lengthInBounds`: `ratio >= 0.5 && ratio <= 2.0`
- `paragraphsMatch`: `diff <= 0.3`

**Dependencies:** None (pure computation)

---

### 3.2 Layer 2: Entity Preservation Check

**Location:** `infrastructure/lambda/qualityReview/index.ts`, function `entityPreservationCheck()`

**Implementation:**
```typescript
function entityPreservationCheck(sourceText: string, translatedText: string) {
    // Regex extraction of dates, numbers, emails from source
    // Verification each appears in translated text
    // Preservation rate calculation
    return { pass: boolean, details: {...} };
}
```

**Patterns matched:**
- Dates: `/\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g`
- Numbers (3+ digits): `/\b\d{3,}\b/g`
- Emails: `/[\w.-]+@[\w.-]+\.\w+/g`

**Pass criteria:** `preservationRate >= 80`

**Dependencies:** None (pure computation)

---

### 3.3 Layer 3: Back-Translation with BLEU Score

**Location:** `infrastructure/lambda/qualityReview/index.ts`, functions `backTranslationCheck()` and `calculateBLEU()`

**BLEU Implementation:**
```typescript
function calculateBLEU(reference: string, candidate: string): number {
    // N-gram precision for n=1 to n=4
    // Clipped count calculation
    // Geometric mean of precisions
    // Brevity penalty
    return bp * Math.exp(logAvg) * 100;
}
```

**Process:**
1. Sample first 5,000 characters of translated text
2. Back-translate via `TranslateTextCommand` (AWS Translate SDK)
3. Calculate BLEU score comparing back-translation against original source
4. Calculate word overlap as secondary metric

**Pass criteria:** `bleuScore >= 15 || wordOverlap >= 40`

**Dependencies:** AWS Translate (`@aws-sdk/client-translate`)

---

### 3.4 Layer 4: AI Review & Correction

**Location:** `infrastructure/lambda/qualityReview/index.ts`, main handler

**Model:** `anthropic.claude-3-7-sonnet-20250219-v1:0` via Amazon Bedrock

**Review prompt** (abbreviated — full text in source file):
- Phase 1: Domain scanning (identifies safeguarding context)
- Phase 2: Error detection with weighted scoring (-30 for reversals, -20 for dangerous mistranslations, -10 for literal failures, -5 for grammar, -3 for untranslated content)
- Phase 3: JSON output (score, domain, summary, verdict, correctionGuidance)

**Correction prompt** includes known failure patterns:
- "coaching" = witness tampering (not sports)
- "Present" in date fields = current (not physical object)
- Ethnicity fields = heritage (not wallpaper)
- Street names remain untranslated
- Professional framework names preserved
- Database labels never translated

**Correction behaviour:**
- Runs on EVERY document regardless of score
- For `.docx`/`.xlsx`/`.pptx`: correction stored as companion `.corrected.txt` file (formatting preserved)
- For `.txt`/`.html`: correction overwrites original file in S3

**Output stored in audit entry:**
- `aiScore`: Claude's quality assessment (0-100)
- `summary`: Brief description of issues
- `verdict`: fit_for_purpose | needs_correction | unsafe
- `correctionApplied`: boolean
- `formattingPreserved`: boolean (true for structured docs)

---

### 3.5 Layer 5: Final BLEU Verification

**Location:** `infrastructure/lambda/qualityReview/index.ts`, after correction application

**Process:**
1. Take the final corrected text (post-Layer 4)
2. Back-translate to English via AWS Translate
3. Calculate BLEU score against original source
4. Store as `finalBleuScore` — the primary auditable metric

**This is the recorded quality metric for governance purposes.** It is:
- Objective (deterministic calculation)
- Reproducible (same input → same score)
- Independent (uses AWS Translate, not Claude, for back-translation)

---

## 4. Custom Terminology

**File:** `docs/afc_terminology_aws.csv`

**AWS Resource:** `arn:aws:translate:eu-west-2:<ACCOUNT_ID>:terminology/afc-safeguarding/LATEST`

**Format:** CSV with headers `en,sq,ar,ta,fa,es,ur,fr,pt,so,tr`

**Term count:** 65+ safeguarding-specific terms across 10 target languages

**Integration point:** The `TranslationTranslate` Step Function (`infrastructure/lib/features/translation/translate.ts`) includes a `listTerminologies` → `parseTerminologies` → `isCustomTerminologyAvailable` flow that automatically applies matching terminologies per target language.

**Relevant code (translate.ts, line ~180):**
```typescript
const createTranslationJob = new tasks.CallAwsService(this, "createTranslationJob", {
    // ...
    parameters: {
        // ...
        "TerminologyNames.$": "$.iterationDetails.setCustomTerminology.Payload",
    },
});
```

---

## 5. DynamoDB Schema (Quality Fields)

**Table:** Translation job table (partition key: `id`)

**Fields written by qualityReview Lambda:**

| Field | Type | Description |
|-------|------|-------------|
| `qualityScore` | Number | Final BLEU score (primary audit metric) |
| `bleuScore` | Number | Same as qualityScore (explicit field for queries) |
| `qualityAudit` | String (JSON) | Full audit trail per language |
| `qualityReviewedAt` | String (ISO 8601) | Timestamp of review completion |

**Audit trail JSON structure per language:**
```json
{
  "language": "it",
  "layers": {
    "structural": { "pass": true, "lengthRatio": 1.12, "lengthInBounds": true, "paragraphsMatch": true },
    "entityPreservation": { "pass": true, "preservationRate": 95.0, "totalEntities": 20, "missingEntities": 1 },
    "backTranslation": { "pass": true, "bleuScore": 22.4, "wordOverlap": 48.3 }
  },
  "allLayersPass": true,
  "aiScore": 72,
  "domain": "Child Protection / Safeguarding",
  "summary": "...",
  "issueCount": 6,
  "verdict": "needs_correction",
  "correctionApplied": true,
  "formattingPreserved": false,
  "originalLength": 68702,
  "correctedLength": 69105,
  "finalBleuScore": 28.4,
  "qualityMetric": 28.4,
  "timestamp": "2026-05-27T14:47:12.000Z"
}
```

---

## 6. Formatting Preservation Logic

**Location:** `infrastructure/lambda/qualityReview/index.ts`, correction section

```typescript
const isStructuredDoc = s3Path.endsWith(".docx") || s3Path.endsWith(".xlsx") || s3Path.endsWith(".pptx");

if (isStructuredDoc) {
    // Store correction as companion file — do NOT overwrite formatted document
    const txtPath = s3Path + ".corrected.txt";
    await s3.send(new PutObjectCommand({ Bucket, Key: txtPath, Body: correctedText }));
    auditEntry.correctionApplied = false;
    auditEntry.formattingPreserved = true;
} else {
    // Plain text — safe to overwrite
    await s3.send(new PutObjectCommand({ Bucket, Key: s3Path, Body: correctedText }));
    auditEntry.correctionApplied = true;
    auditEntry.formattingPreserved = false;
}
```

**Rationale:** AWS Translate's `StartTextTranslationJob` preserves `.docx` structure (tables, headers, styles) natively. Overwriting with plain text from Claude would destroy this formatting. The AI correction is stored separately for audit reference.

---

## 7. PDF Handling

**File:** `infrastructure/lambda/pdfConversion/index.ts`

**Strategy:**
1. Attempt direct text extraction via `pdf-parse` (for born-digital PDFs)
2. Fall back to AWS Textract `DetectDocumentText` (for scanned/image PDFs)
3. If neither succeeds, mark job as FAILED with descriptive error

**Bundled dependency:** `pdf-parse` (specified in `infrastructure/lib/features/translation/pdfAndWordCount.ts` as `bundlingNodeModules`)

**Size limit:** 4MB (enforced in Lambda, also validated client-side)

---

## 8. Error Handling

**Quality review Lambda failures do NOT block the pipeline.** The Step Function invokes the Lambda with `resultPath: sfn.JsonPath.DISCARD` — if the Lambda throws, the Step Function still completes and the translation is delivered.

**File:** `infrastructure/lib/features/translation/main.ts`
```typescript
const invokeQualityReview = new tasks.LambdaInvoke(this, "invokeQualityReview", {
    lambdaFunction: qualityReviewLambda.lambdaFunction,
    resultPath: sfn.JsonPath.DISCARD,  // Failure doesn't block pipeline
    payload: sfn.TaskInput.fromObject({
        jobDetails: sfn.JsonPath.objectAt("$.jobDetails"),
    }),
});
```

**Implication:** If Bedrock is unavailable or the Lambda times out, the user still receives the AWS Translate output (with terminology applied) but without the AI correction pass. The audit trail will show `qualityScore: -1` indicating the review did not complete.

---

## 9. Security & Data Residency

| Aspect | Implementation | Verification |
|--------|---------------|--------------|
| Region lock | All services deployed in `eu-west-2` | Check `infrastructure/bin/deploy-direct.ts` env config |
| Bedrock region | Client instantiated with `process.env.AWS_REGION` | Lambda environment variable set by CDK |
| No model training | Amazon Bedrock default policy | AWS Bedrock service terms |
| S3 encryption | `BucketEncryption.S3_MANAGED` | Check `infrastructure/lib/features/translation/translation.ts` |
| S3 SSL enforcement | `enforceSSL: true` | Same file |
| Document lifecycle | 7-day expiration rule on content bucket | Same file, `addLifecycleRule` |
| IAM least privilege | Scoped policies per Lambda | Check CDK NagSuppressions for documented exceptions |

---

## 10. Verification Procedure for Reviewer

### 10.1 Confirm QA Lambda exists in pipeline

1. Open `infrastructure/lib/features/translation/main.ts`
2. Verify `qualityReviewLambda` is instantiated with path `lambda/qualityReview`
3. Verify `invokeQualityReview` task is chained after `updateDbJobStatus` in both Step Function definitions (with-PII and without-PII branches)

### 10.2 Confirm all 5 layers execute

1. Open `infrastructure/lambda/qualityReview/index.ts`
2. Verify `structuralCheck()` is called before AI review
3. Verify `entityPreservationCheck()` is called before AI review
4. Verify `backTranslationCheck()` is called before AI review (uses `TranslateTextCommand`)
5. Verify `calculateBLEU()` is implemented with n-gram precision (n=1 to n=4) and brevity penalty
6. Verify Claude `InvokeModelCommand` is called with the review prompt
7. Verify final BLEU calculation runs after correction (Layer 5)

### 10.3 Confirm terminology integration

1. Open `docs/afc_terminology_aws.csv` — verify header row is language codes only
2. Open `infrastructure/lib/features/translation/translate.ts` — verify `listTerminologies`, `parseTerminologies`, and `TerminologyNames` parameter in `createTranslationJob`

### 10.4 Confirm formatting preservation

1. Open `infrastructure/lambda/qualityReview/index.ts`
2. Search for `isStructuredDoc` — verify `.docx`, `.xlsx`, `.pptx` are not overwritten
3. Verify companion `.corrected.txt` file is written instead

### 10.5 Confirm audit trail storage

1. Search for `UpdateItemCommand` in the quality review Lambda
2. Verify `qualityScore`, `qualityAudit`, `qualityReviewedAt`, and `bleuScore` are written
3. Verify the audit JSON structure includes all layer results

### 10.6 Confirm BLEU is the primary metric

1. Verify `finalBleuScore` is calculated AFTER the correction pass
2. Verify `qualityScore` in DynamoDB is set to the BLEU value (not the AI score)
3. Verify the AI score (`aiScore`) is stored in the audit trail but NOT as the primary `qualityScore`

---

## 11. Known Technical Debt

| Item | Location | Risk | Notes |
|------|----------|------|-------|
| Lambda timeout (15 min) may be insufficient for very large documents with multiple languages | `main.ts` | Medium | Monitor CloudWatch for timeout errors |
| Lambda memory (128 MB) may be insufficient for large document processing | `main.ts` | Low | Increase if OOM errors observed |
| `resultPath: DISCARD` means QA failures are silent | `main.ts` | Medium | Consider adding CloudWatch alarm on Lambda errors |
| Back-translation sample limited to 5,000 chars | `qualityReview/index.ts` | Low | Sufficient for quality signal; full doc would increase cost |
| BLEU score is calculated on back-translated text, not direct comparison | `qualityReview/index.ts` | Medium | Inherent limitation — no direct source↔translation comparison possible without bilingual evaluation |
| Terminology glossary only covers 10 languages | `afc_terminology_aws.csv` | Medium | Languages not covered rely solely on AI correction |
| JSON parse fallback extracts score only | `qualityReview/index.ts` | Low | If Claude returns malformed JSON, we still get the score via regex |

---

## 12. Dependencies

| Package | Version | Location | Purpose |
|---------|---------|----------|---------|
| `@aws-sdk/client-s3` | Runtime (Lambda) | qualityReview | S3 read/write |
| `@aws-sdk/client-dynamodb` | Runtime (Lambda) | qualityReview | Audit trail storage |
| `@aws-sdk/client-bedrock-runtime` | Runtime (Lambda) | qualityReview | Claude invocation |
| `@aws-sdk/client-translate` | Runtime (Lambda) | qualityReview | Back-translation |
| `pdf-parse` | ^1.1.1 | pdfConversion | PDF text extraction |
| `mammoth` | ^1.8.0 | wordCount | DOCX text extraction |
| `xlsx` | ^0.18.5 | wordCount | Spreadsheet text extraction |
| `aws-cdk-lib` | ^2.240.0 | infrastructure | CDK constructs |
| `esbuild` | ^0.25.0 | infrastructure | Lambda bundling |

---

*End of specification.*
