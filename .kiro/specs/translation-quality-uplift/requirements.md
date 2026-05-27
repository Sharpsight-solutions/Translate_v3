# Translation Quality Uplift — Requirements

## Feature Overview
Uplift translation quality from the current baseline of 64/100 to a target of 85/100 for safeguarding documents processed through the Document Translation Service. The current pipeline uses single-engine AWS Translate with a post-hoc AI correction pass. This uplift introduces artifact detection, terminology enforcement, multi-engine translation, source-grounded synthesis, and register-aware prompting.

## Context
- **Organisation:** Achieving for Children (children's services)
- **Document types:** Statutory safeguarding assessments, child protection conference minutes, court reports
- **Languages:** 10 target languages (Albanian, Arabic, Tamil, Farsi, Spanish, Urdu, French, Portuguese, Somali, Turkish)
- **Current score:** 64/100 (evaluated by independent AI review against source)
- **Target score:** 85/100 (fit for purpose in statutory/legal context)
- **Primary metric:** BLEU score (objective, reproducible, auditable)
- **Region:** eu-west-2 only (UK data sovereignty)

## Requirements

### REQ-01: Domain Terminology Enforcement with Gap Detection
**User Story:** As a service administrator, I want the translation pipeline to enforce domain-specific terminology so that critical safeguarding terms are never mistranslated.

**Acceptance Criteria:**
- [ ] A terminology verification step runs AFTER translation and BEFORE AI correction
- [ ] The step checks translated output against the `afc_terminology_aws.csv` glossary
- [ ] Any term from the glossary that appears in the source but is incorrectly translated in the output is flagged
- [ ] Flagged terms are passed to the AI correction step as explicit correction instructions
- [ ] Gap detection: if a source term has no glossary entry for the target language, it is logged for admin review
- [ ] Terminology violations are recorded in the audit trail per language
- [ ] The glossary supports incremental updates without redeployment (S3-hosted CSV)

### REQ-02: Multi-Engine Parallel Translation
**User Story:** As a service administrator, I want documents translated by multiple engines in parallel so that the best segments from each can be selected.

**Acceptance Criteria:**
- [ ] Each document is translated by both AWS Translate AND Claude 3.7 Sonnet (via Bedrock)
- [ ] Both translations run in parallel (not sequential) to minimise latency
- [ ] AWS Translate uses the custom terminology glossary; Claude receives terminology as prompt context
- [ ] Both outputs are stored in S3 for audit purposes
- [ ] The pipeline proceeds to segment comparison regardless of which engine completes first
- [ ] If one engine fails, the pipeline continues with the successful engine's output
- [ ] Cost per job is tracked and visible in the admin dashboard

### REQ-03: Source-Grounded LLM Synthesis for Contested Segments
**User Story:** As a service administrator, I want an AI synthesis step that resolves disagreements between translation engines by referring back to the source text, so that the final output is grounded in the original meaning.

**Acceptance Criteria:**
- [ ] After parallel translation, segments where the two engines disagree are identified
- [ ] Disagreement is measured by semantic similarity (Titan Embeddings cosine distance)
- [ ] Segments with similarity below threshold (< 0.85) are flagged as "contested"
- [ ] A synthesis LLM call receives: source segment, Engine A output, Engine B output, and terminology constraints
- [ ] The synthesis prompt explicitly instructs the model to prefer the source meaning over either engine
- [ ] For non-contested segments, the higher-quality engine output is selected (based on terminology compliance)
- [ ] The final merged document is assembled from best/synthesised segments
- [ ] Contested segment count and resolution method are recorded in the audit trail

### REQ-04: Artifact & Hallucination Detection
**User Story:** As a service administrator, I want the pipeline to detect and remove translation artifacts (hallucinated content, untranslated fragments, encoding errors) before the document reaches the user.

**Acceptance Criteria:**
- [ ] A detection step runs on the final merged translation before delivery
- [ ] Detects: untranslated English fragments in target text, repeated phrases (>3 consecutive repetitions), encoding artifacts (mojibake patterns), content significantly longer than source (>2x ratio per segment)
- [ ] Detected artifacts are automatically removed or flagged for the AI correction step
- [ ] If artifact density exceeds 10% of segments, the job is flagged as "needs_review" (not delivered automatically)
- [ ] Artifact detection results are recorded in the audit trail
- [ ] Detection runs without external API calls (pure regex/heuristic — zero cost, instant)

### REQ-05: Register-Aware Target Language Prompting
**User Story:** As a service administrator, I want the AI translation and correction steps to use register-appropriate language for each target culture, so that documents read naturally to native speakers in a professional context.

**Acceptance Criteria:**
- [ ] Each target language has a register profile (formal/informal, honorifics, professional tone guidance)
- [ ] The Claude translation prompt (REQ-02) includes register instructions per target language
- [ ] The AI correction prompt includes register instructions per target language
- [ ] Register profiles are configurable without code changes (stored as JSON in S3 or as part of the glossary)
- [ ] The system defaults to formal/professional register if no profile exists for a language
- [ ] Register compliance is assessed as part of the AI review scoring

## Deployment Order
1. **REQ-04** (Artifact Detection) — lowest risk, zero cost, immediate quality gain
2. **REQ-01** (Terminology Enforcement) — builds on existing glossary, low risk
3. **REQ-02** (Multi-Engine Translation) — infrastructure change, moderate cost
4. **REQ-03** (Source-Grounded Synthesis) — depends on REQ-02 outputs
5. **REQ-05** (Register-Aware Prompting) — prompt engineering, can be tuned iteratively

## Out of Scope
- Human-in-the-loop review (HITL)
- Real-time translation (all documents go through standard pipeline)
- Additional language support beyond current 10
- Changes to the frontend translation form
- Changes to document upload/download flow
