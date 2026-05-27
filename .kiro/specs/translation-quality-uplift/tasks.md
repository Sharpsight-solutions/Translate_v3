# Translation Quality Uplift — Tasks

## Implementation Tasks (Deployment Order)

### Phase 1: REQ-04 — Artifact & Hallucination Detection
_Lowest risk, zero external API cost, immediate quality gain_

- [x] **Task 1.1:** Add `detectArtifacts()` function to `infrastructure/lambda/qualityReview/index.ts`
  - Implement untranslated fragment detection (English common words in non-English output)
  - Implement repeated phrase detection (>3 consecutive identical sentences)
  - Implement mojibake/encoding artifact detection
  - Implement per-segment length anomaly detection (>2.5x or <0.3x ratio)
  - Return `ArtifactReport` with density calculation and `needsReview` flag
  - Insert as Layer 3.6 (runs after back-translation, before AI correction)

- [x] **Task 1.2:** Pass artifact report to Layer 4 AI correction prompt
  - Modify the correction prompt to include artifact removal instructions
  - If `needsReview` (density > 10%), set job status to `NEEDS_REVIEW` instead of `COMPLETED`
  - Store `artifactReport` JSON in DynamoDB audit trail

- [x] **Task 1.3:** Deploy and validate
  - Run `cdk deploy` with updated Lambda
  - Submit test document and verify artifact detection runs in CloudWatch logs
  - Confirm no regression on existing pipeline behaviour

### Phase 2: REQ-01 — Domain Terminology Enforcement
_Builds on existing glossary, low risk_

- [x] **Task 2.1:** Add `verifyTerminology()` function to `infrastructure/lambda/qualityReview/index.ts`
  - Load `afc_terminology_aws.csv` from S3 (CONTENT_BUCKET or hardcoded key)
  - Parse CSV into term map: `{ en: string, [targetLang]: string }`
  - For each English term found in source text, check if correct target term appears in translation
  - Return `TerminologyViolation[]` with `{ sourceTerm, expectedTranslation, foundText }`
  - Detect gaps: terms where target language column is empty

- [x] **Task 2.2:** Integrate terminology violations into Layer 4 correction prompt
  - Add explicit "TERMINOLOGY CORRECTIONS REQUIRED" section to correction prompt
  - List each violation as a non-negotiable correction instruction
  - Log gap detections to CloudWatch for admin visibility

- [x] **Task 2.3:** Add `GLOSSARY_KEY` environment variable to quality review Lambda in CDK
  - Update `infrastructure/lib/features/translation/main.ts` to pass glossary S3 key
  - Grant S3 read permission for glossary path
  - Store terminology violation count in DynamoDB audit trail

- [x] **Task 2.4:** Deploy and validate
  - Submit document containing known glossary terms (e.g., "coaching", "neglect")
  - Verify violations are detected and passed to correction prompt
  - Confirm corrected output uses correct terminology

### Phase 3: REQ-02 — Multi-Engine Parallel Translation
_Infrastructure change, moderate cost increase_

- [x] **Task 3.1:** Create `infrastructure/lambda/bedrockTranslation/index.ts`
  - Read source text from S3 (same path as AWS Translate)
  - Load terminology glossary for relevant target languages
  - Load register profiles from S3
  - For each target language: invoke Claude 3.7 Sonnet with translation prompt
  - Store output in S3 at `{s3PrefixToJobId}/bedrock-output/{langCode}/{filename}`
  - Write `bedrockTranslateKey` map to DynamoDB
  - Handle timeout gracefully (partial results stored)

- [x] **Task 3.2:** Create `docs/register_profiles.json`
  - Define register profiles for all 10 target languages
  - Include: formality level, honorific guidance, tone description, cultural notes
  - Validate JSON structure

- [x] **Task 3.3:** Add Bedrock Translation Lambda to CDK construct
  - Create `dt_lambda` construct in `infrastructure/lib/features/translation/main.ts`
  - Configure: 10-min timeout, 512 MB memory, environment variables
  - Grant IAM: `bedrock:InvokeModel`, S3 read/write, DynamoDB update
  - Add CDK Nag suppressions

- [x] **Task 3.4:** Modify Step Function to run translations in parallel
  - Replace sequential `startSfnTranslate` with `sfn.Parallel` branch
  - Branch 1: existing `startSfnTranslate` (AWS Translate)
  - Branch 2: new `invokeBedrockTranslation` (Lambda invoke)
  - Handle partial failure (one branch fails, other succeeds)
  - Pass both result paths to downstream steps

- [x] **Task 3.5:** Deploy and validate parallel translation
  - Submit test document, verify both engines produce output in S3
  - Check CloudWatch logs for both Lambda executions
  - Verify DynamoDB has both `translateKey` and `bedrockTranslateKey`
  - Confirm pipeline completes even if Bedrock translation fails

### Phase 4: REQ-03 — Source-Grounded LLM Synthesis
_Depends on REQ-02 outputs_

- [x] **Task 4.1:** Add segment comparison logic to quality review Lambda
  - Read both translations from S3 (AWS Translate + Bedrock)
  - Split into paragraph-level segments
  - For each segment pair: calculate cosine similarity via Titan Embeddings
  - Classify as "agreed" (>= 0.85) or "contested" (< 0.85)
  - For agreed segments: select based on terminology compliance score
  - Store comparison metadata in audit trail

- [x] **Task 4.2:** Add synthesis prompt for contested segments
  - For each contested segment: invoke Claude with source + both engine outputs + terminology
  - Synthesis prompt instructs model to ground decision in source meaning
  - Assemble final merged document from best/synthesised segments
  - Store merged document in S3 (replaces AWS Translate output path for downstream)

- [x] **Task 4.3:** Add Titan Embeddings IAM permission
  - Update quality review Lambda IAM to include `bedrock:InvokeModel` for Titan Embeddings
  - Model ID: `amazon.titan-embed-text-v2:0`
  - Update CDK Nag suppressions

- [x] **Task 4.4:** Implement graceful degradation
  - If `bedrockTranslateKey` is missing: skip comparison, use AWS Translate only
  - If Titan Embeddings fails: skip similarity check, use terminology compliance as selector
  - If synthesis fails for a segment: fall back to AWS Translate segment
  - Log all fallback decisions in audit trail

- [x] **Task 4.5:** Deploy and validate synthesis
  - Submit document with known terminology challenges
  - Verify contested segments are identified in logs
  - Verify synthesis produces output grounded in source
  - Compare final BLEU score against v1 pipeline baseline

### Phase 5: REQ-05 — Register-Aware Prompting
_Prompt engineering, iterative tuning_

- [x] **Task 5.1:** Integrate register profiles into Bedrock Translation Lambda
  - Load `register_profiles.json` from S3 at Lambda cold start
  - Include register section in Claude translation prompt per target language
  - Default to generic formal prompt if profile missing

- [x] **Task 5.2:** Integrate register profiles into quality review correction prompt
  - Load register profiles in quality review Lambda
  - Add "REGISTER REQUIREMENTS" section to correction prompt
  - Include formality, honorifics, and tone guidance

- [x] **Task 5.3:** Add register compliance to AI review scoring prompt
  - Update the `REVIEW_PROMPT` to include register assessment
  - Add scoring penalty for register violations (informal language in formal context)
  - Record register compliance in audit trail

- [x] **Task 5.4:** Deploy and validate register awareness
  - Submit document targeting French (clear formal/informal distinction)
  - Verify output uses "vous" not "tu"
  - Submit document targeting Spanish, verify "usted" usage
  - Compare quality scores with and without register prompting

### Phase 6: Integration & Validation

- [ ] **Task 6.1:** End-to-end regression test
  - Re-submit the Luigi & Vittoria Fabiani document (Italian target)
  - Compare BLEU score against 64/100 baseline
  - Verify all new layers appear in audit trail
  - Confirm .docx formatting preservation still works

- [ ] **Task 6.2:** Update admin dashboard with new quality metrics
  - Display `qualityPipelineVersion` (v1 vs v2)
  - Show contested segment count and resolution method
  - Show terminology violation count
  - Show artifact detection results

- [ ] **Task 6.3:** Update Technical Quality Control Specification
  - Document new layers (3.5, 3.6, 3.7)
  - Document parallel translation architecture
  - Document register profiles
  - Update verification procedures

- [ ] **Task 6.4:** Push to GitHub and invalidate CloudFront
  - Commit all changes
  - Push to `main` branch on `Sharpsight-solutions/Translate_v3`
  - Deploy infrastructure: `$env:skipNag = "true"; npx cdk@latest deploy --app "npx ts-node bin/deploy-direct.ts" --all --require-approval never`
  - Rebuild and sync website
  - Invalidate CloudFront cache
