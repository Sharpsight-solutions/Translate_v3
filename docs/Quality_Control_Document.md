# Quality Control Document
## Document Transformation Service

**Organisation:** Achieving for Children  
**Service:** Document Transformation Portal  
**Version:** 2.0  
**Date:** May 2026  
**Classification:** Internal — For Independent Review  

---

## What This Document Covers

This document explains how we check the quality of every translation produced by the service. It is written for non-technical reviewers who need to understand what safeguards are in place and whether they are sufficient for use in children's services.

---

## Why Quality Control Matters

This service translates documents used in child protection, safeguarding and family communications. A translation error in this context is not a minor inconvenience — it could:

- Reverse the meaning of who harmed whom
- Misrepresent a child's testimony
- Cause a family to misunderstand their legal rights
- Delay a time-critical intervention

Every document must therefore pass through multiple independent checks before it reaches the user.

---

## The Five Checks Every Translation Goes Through

When a staff member uploads a document for translation, it passes through five separate quality checks before the translated version becomes available for download. These checks happen automatically.

---

### Check 1: Is the document structurally intact?

**What it does:** Compares the shape of the translated document against the original to catch major failures.

**What it looks for:**
- The translation is not empty or blank
- The translation is a reasonable length (not suspiciously short or long compared to the original)
- The number of paragraphs is roughly the same as the original (content hasn't been dropped)

**Why it matters:** Catches cases where the translation engine failed silently — producing a blank file, a truncated output, or a document with large sections missing.

**How it works:** Simple mathematical comparison. No external service involved. Cannot fail.

---

### Check 2: Are facts and figures preserved?

**What it does:** Verifies that factual data which should never change during translation has survived intact.

**What it looks for:**
- Dates (e.g. 14/09/2020) appear unchanged in the translation
- Reference numbers (e.g. case IDs, tracking numbers) are preserved
- Email addresses are not translated or corrupted

**Why it matters:** In safeguarding documents, a wrong date of birth or a corrupted case reference number could cause confusion. These values must pass through translation untouched.

**How it works:** Pattern matching against the original. No external service involved.

---

### Check 3: Does the meaning survive a round trip?

**What it does:** Takes the translated document, translates it back to English using a completely different translation system, and compares the result against the original.

**What it looks for:**
- The back-translated text shares significant vocabulary with the original (measured using BLEU score — an industry-standard metric for translation quality)
- Key phrases and concepts from the original are present in the round-trip version

**Why it matters:** If you translate English → Italian → English and the result is unrecognisable, the Italian version has lost meaning. This check uses a different translation engine (AWS Translate) to the correction engine (Claude), providing independent verification.

**How it works:** AWS Translate performs the back-translation. A BLEU score is calculated comparing the back-translation against the original. BLEU scores above 30 indicate good quality; below 15 indicates concern.

---

### Check 4: AI review and correction

**What it does:** An AI language model (Claude 3.7 Sonnet) reads both the original English and the translation, identifies errors, and produces a corrected version.

**What it looks for:**
- **Meaning reversals** — sentences where the translation changes who did what (e.g. victim becomes perpetrator)
- **Dangerous mistranslations** — domain-specific terms translated incorrectly (e.g. a child's "account" becoming a digital account, "coaching" becoming sports training)
- **Literal word-for-word failures** — phrases translated word-by-word that no native speaker would write
- **Grammar and syntax errors** — broken grammar, wrong gender, incorrect verb forms
- **Tone failures** — informal language where formal/legal tone is required
- **Untranslated content** — English words left in the target language output

**What it produces:**
- A quality score (0–100)
- A corrected version of the translation with errors fixed
- An audit summary documenting what was found

**Why it matters:** This is the most thorough check. The AI understands context — it knows that in a safeguarding document, "coaching" means witness tampering, not sports training. It applies corrections that a simple rule-based system would miss.

**Known failure patterns it specifically watches for:**
- "coaching" in safeguarding = witness tampering/priming (not sports)
- "Present" in date fields = current/today (not a physical object)
- Ethnicity descriptions = heritage/origin (not wallpaper/backdrop)
- Street names in addresses should remain untranslated
- Professional framework names (e.g. "Zones of Regulation") must not be garbled
- Database field labels and reference numbers must never be translated

**How it works:** Amazon Bedrock (Claude 3.7 Sonnet), hosted in the UK (eu-west-2). The AI does not store or learn from the documents.

---

### Check 5: Grounding verification (anti-hallucination)

**What it does:** After the AI correction is applied, verifies that the corrected version hasn't introduced any new factual content that wasn't in the original document.

**What it looks for:**
- Numbers in the corrected text that don't appear in either the original or the pre-correction translation
- Dates that weren't in the source document
- Any factual content that appears to have been invented

**Why it matters:** AI language models can occasionally "hallucinate" — generating plausible-sounding content that isn't grounded in the source material. This check catches that.

**How it works:** Comparison of factual elements (numbers, dates) between source, original translation, and corrected translation. No external service involved.

---

## Additional Safeguard: Terminology Glossary

Beyond the five automated checks, the service uses a managed terminology glossary containing 70+ safeguarding-specific terms with locked translations in 10 languages.

**What it does:** Forces the translation engine to use pre-approved translations for critical domain terms, overriding whatever the neural model would otherwise produce.

**Examples:**

| English term | What it means | Common MT error | Locked translation (Italian) |
|-------------|---------------|-----------------|------------------------------|
| coaching (of children) | Witness tampering/priming | Sports training (addestramento) | condizionamento |
| account | Child's testimony | Digital/financial account | resoconto |
| contact | Supervised family visit | Phone/digital contact | contatto supervisionato |
| disclosure | Child revealing abuse | Data disclosure | rivelazione |
| placement | Foster care arrangement | Job placement | collocamento |
| significant harm | Legal threshold for intervention | General harm | danno significativo |

**How it works:** AWS Translate Custom Terminology. Applied automatically before neural translation. Cannot be overridden by the AI model.

---

## What Happens to Documents That Score Poorly

| AI Quality Score | Interpretation | What happens |
|-----------------|----------------|--------------|
| 85–100 | Good quality | Correction applied, document delivered |
| 50–84 | Needs improvement | Correction applied, document delivered with improvements |
| Below 50 | Serious concerns | Correction applied, flagged in audit trail for admin review |

All documents receive the AI correction pass regardless of score. The score is recorded for monitoring purposes.

---

## Document Formatting

| Upload format | What the user gets back |
|---------------|------------------------|
| Word (.docx) | Formatted Word document with tables, headers, and styles preserved |
| Plain text (.txt) | Corrected plain text file |
| HTML (.html) | Corrected HTML file |

For Word documents, the AI correction is stored as a companion reference file. The user receives the formatted AWS Translate output (which preserves document structure) rather than a plain text replacement.

---

## What Gets Recorded (Audit Trail)

Every translation job stores a complete quality record:

- **Quality score** (0–100) per target language
- **BLEU score** from back-translation verification
- **Structural check results** (pass/fail with details)
- **Entity preservation rate** (percentage of dates/numbers preserved)
- **Whether correction was applied** (yes/no)
- **Grounding check result** (pass/fail)
- **Timestamp** of quality review
- **Domain detected** (e.g. "Child Protection / Safeguarding")
- **Summary** of issues found

This audit trail is retained indefinitely and is available to administrators via the dashboard.

---

## Architecture Overview

```
USER uploads document
         │
         ▼
┌─────────────────────────────────┐
│  TRANSLATION (AWS Translate)     │
│  + Terminology Glossary (700     │
│    locked safeguarding terms)    │
└─────────────────┬───────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│         QUALITY ASSURANCE GATEWAY                │
│                                                  │
│  ┌───────────────────────────────────────────┐  │
│  │ Check 1: Structural Integrity      [FREE] │  │
│  │ • Not empty • Length ratio • Paragraphs   │  │
│  └───────────────────────────────────────────┘  │
│                      │                           │
│  ┌───────────────────────────────────────────┐  │
│  │ Check 2: Entity Preservation       [FREE] │  │
│  │ • Dates • Numbers • References            │  │
│  └───────────────────────────────────────────┘  │
│                      │                           │
│  ┌───────────────────────────────────────────┐  │
│  │ Check 3: Back-Translation + BLEU  [£0.00] │  │
│  │ • Round-trip via independent system       │  │
│  │ • BLEU score calculation                  │  │
│  └───────────────────────────────────────────┘  │
│                      │                           │
│  ┌───────────────────────────────────────────┐  │
│  │ Check 4: AI Review & Correction   [£0.12] │  │
│  │ • Domain-aware quality scoring            │  │
│  │ • Correction of all identified errors     │  │
│  │ • Known failure pattern detection         │  │
│  └───────────────────────────────────────────┘  │
│                      │                           │
│  ┌───────────────────────────────────────────┐  │
│  │ Check 5: Grounding Verification    [FREE] │  │
│  │ • No hallucinated content introduced      │  │
│  └───────────────────────────────────────────┘  │
│                                                  │
└──────────────────────┬──────────────────────────┘
                       │
                       ▼
         USER downloads corrected translation
         (Audit trail stored for governance)
```

---

## Data Handling

| Question | Answer |
|----------|--------|
| Where is data processed? | UK only (AWS eu-west-2, London) |
| Is data sent to third parties? | No |
| Is data used to train AI models? | No (Bedrock policy prohibits this) |
| How long are documents kept? | 7 days, then automatically deleted |
| Who can see document content? | Only the user who uploaded it |
| Who can see quality scores? | Administrators (metadata only, not content) |
| Is the audit trail retained? | Yes, indefinitely |

---

## Known Limitations

1. **AI correction is not infallible.** It significantly improves quality but cannot guarantee perfection. For legally binding court submissions, professional human review remains the gold standard.

2. **Some languages perform better than others.** European languages (Spanish, French, Italian) generally produce higher quality translations than less-resourced languages (Pashto, Dari, Amharic).

3. **The terminology glossary covers 10 languages.** Languages not in the glossary rely solely on the AI correction to catch domain-specific errors.

4. **Document formatting.** Word document structure is preserved, but complex layouts (nested tables, text boxes, watermarks) may not translate perfectly.

5. **The BLEU score has limits.** It measures word-level overlap, not deep semantic meaning. A sentence with reversed subject/object may score well on BLEU while being dangerously wrong. This is why Check 4 (AI review) exists as a complementary layer.

---

## How to Verify This System Works

### For an independent reviewer:

1. Select 10 documents of varying type and language
2. Submit each through the service
3. Have a qualified bilingual professional review the output
4. Compare the professional's assessment against the system's quality score
5. Check whether the specific errors identified in this document's "Known Failure Patterns" section have been eliminated

### Acceptance criteria:

- No meaning reversals in any final output
- No dangerous mistranslations of safeguarding terminology
- System quality score within ±15 points of independent reviewer's score
- All dates, numbers, and reference codes preserved exactly
- Professional reviewer rates ≥80% of documents as "fit for purpose"

---

## Continuous Improvement

The system improves over time through:

1. **Terminology glossary updates** — new problem terms added as they're discovered
2. **AI prompt refinement** — known failure patterns added to the correction prompt
3. **User feedback** — 👍/👎 ratings on every translation flag quality issues
4. **Admin dashboard** — AI-powered insights identify trends and recurring problems
5. **Audit trail analysis** — patterns in low-scoring translations inform targeted fixes

---

## Cost of Quality Assurance

| Per document (one language) | Cost |
|----------------------------|------|
| Checks 1, 2, 5 | Free |
| Check 3 (back-translation) | £0.0002 |
| Check 4 (AI review + correction) | £0.12 |
| **Total QA cost** | **~£0.12** |

At current volume: approximately £2–5 per month.

---

*This document should be reviewed quarterly and updated as the service matures.*
