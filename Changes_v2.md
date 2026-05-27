# Kiro Spec: Document Translation — Frontend Enhancements

**Project**: aws-samples/document-translation fork  
**Organisation**: Achieving for Children  
**Author**: Sharp Sight Solutions  
**Version**: 1.0  

---

## Overview

This spec covers two frontend enhancements to the existing Document Translation deployment:

1. Branded welcome screen replacing the default Cognito/Amplify login page
2. Standalone readability checker tool allowing staff to evaluate document text against the Flesch Reading Ease framework before translating

---

## Requirements

### REQ-01 — Branded Welcome Screen

**As a** staff member  
**I want** to see a clear, branded welcome page when I visit the translation service  
**So that** I understand what the tool is, who it is for, and what I am signing up for

**Acceptance Criteria**
- The default Amplify/Cognito hosted UI login page is replaced with a custom React welcome screen
- The AfC logo is displayed prominently using the official colour asset
- The page clearly identifies the service as the "Document Translation Service" with a "Staff portal" designation
- Four capability statements are displayed explaining what the service does
- The sign-in form is presented inline on the same page (no redirect to a separate hosted UI)
- A "Create an account" link is accessible for new users
- A restriction note informs users that access requires an `@achievingforchildren.org.uk` email address, with guidance to contact their line manager if they need access
- The page is fully responsive and accessible (WCAG 2.1 AA)
- No references to AWS or Amazon are visible to staff

**Brand Specification**
- Primary colour: `#4A4A6A` (AfC slate)
- Accent colour: `#F5B800` (AfC amber/gold)
- Logo: hosted static asset (see Asset Notes below)
- Left panel background: `#4A4A6A`
- Button hover state: amber `#F5B800` with dark text `#2A2A3A`
- Feature bullet icons: amber `#F5B800` using Tabler outline icon set

**Copy (exact)**

Service title: `Document Translation Service`  
Badge: `Staff portal`  
Description: `Translate documents quickly to support residents and families across our communities.`

Feature bullets:
- Upload documents in Word, PDF, HTML and spreadsheet formats
- Translate into multiple languages in a single submission
- Securely hosted within AfC's data environment
- Results available within minutes, accessible from your job history

Sign-in heading: `Sign in to continue`  
Sign-in subheading: `Use your Achieving for Children work email address to access the service.`  
Register link: `New to the service? Create an account`  
Restriction note: `Access is restricted to staff with an @achievingforchildren.org.uk email address. If you need access, please contact your line manager.`

---

### REQ-02 — Readability Checker

**As a** staff member  
**I want** to check the readability of a document before I translate it  
**So that** I can simplify complex language and ensure translated output is accessible to residents

**Acceptance Criteria**
- A "Readability checker" page is accessible from the main navigation for all authenticated users
- Staff can paste or type text directly into a text area input
- On clicking "Check readability", the tool calculates and displays the Flesch Reading Ease score (0–100)
- The score is displayed alongside three supporting metrics: word count, sentence count, and average words per sentence
- A progress bar and band label contextualise the score (see Score Bands below)
- The target score of 90+ is clearly communicated
- If the score is below 90, the tool surfaces up to 6 specific, actionable improvement suggestions
- If the score is 90 or above, a positive confirmation is shown with no unnecessary suggestions
- A "Clear" button resets the input and results
- The tool works entirely client-side — no text is sent to any external service or stored anywhere

**Score Bands**

| Score range | Label | Status |
|-------------|-------|--------|
| 90–100 | Very easy to read — suitable for all audiences | Target met |
| 70–89 | Fairly easy to read — most adults can follow | Needs work |
| 50–69 | Fairly difficult — some readers may struggle | Below target |
| 0–49 | Difficult to read — likely to exclude many residents | Below target |

**Suggestion Categories**

The tool identifies and surfaces suggestions across three categories:

1. Long sentences — sentences over 20 words flagged with word count and a prompt to split them into sentences of 10–15 words
2. Complex words — specific word substitutions drawn from a plain English replacement list (see Word List below)
3. Passive voice — flags passive constructions (e.g. "will be sent to you") and prompts active rewrites

**Plain English Word Substitution List**

| Original | Replace with |
|----------|-------------|
| utilise | use |
| commence | start |
| terminate | end |
| ascertain | find out |
| purchase | buy |
| provide assistance | help |
| in order to | to |
| at this point in time | now |
| with regard to | about |
| due to the fact that | because |
| facilitate | help |
| subsequently | then |
| prior to | before |
| additionally | also |
| nevertheless | but |
| approximately | about |

This list should be stored as a configurable constant so it can be extended without code changes.

---

## Technical Approach

### Change 1 — Welcome Screen Component (REQ-01)

**File to create**: `src/components/WelcomeScreen/index.jsx`

The component replaces the default Amplify Authenticator UI. The existing app likely wraps content in `<Authenticator>` from `@aws-amplify/ui-react` — the welcome screen sits outside this wrapper and renders a custom sign-in form that calls Amplify Auth directly:

```javascript
import { signIn } from 'aws-amplify/auth';

const handleSignIn = async ({ email, password }) => {
  try {
    await signIn({ username: email, password });
  } catch (err) {
    setError(err.message);
  }
};
```

**Layout**: Two-column grid. Left panel is the brand/information panel. Right panel contains the sign-in form. On mobile (below 640px) the layout stacks vertically with the brand panel above the form.

**Logo asset**: Reference via a relative import or a CloudFront/S3 URL. The PNG logo file should be added to `public/assets/afc-logo.png` and referenced as `/assets/afc-logo.png`. Do not embed the logo as base64.

**Routing**: The welcome screen renders at the root route `/` when the user is unauthenticated. On successful sign-in, redirect to `/` which then renders the authenticated app shell.

---

### Change 2 — Readability Checker Page (REQ-02)

**File to create**: `src/pages/Readability/index.jsx`

**Route**: `/readability` — add to the existing React Router config.

**Navigation**: Add a "Readability checker" link to the existing authenticated navigation, visible to all users (no admin restriction).

**Flesch Reading Ease calculation** (client-side, no external library needed):

```javascript
const countSyllables = (word) => {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return 0;
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches ? matches.length : 1;
};

const calculateFlesch = (text) => {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 2);
  const words = text.match(/\b[a-zA-Z']+\b/g) || [];
  if (!sentences.length || !words.length) return null;
  const syllables = words.reduce((acc, w) => acc + countSyllables(w), 0);
  const asl = words.length / sentences.length;
  const asw = syllables / words.length;
  const score = 206.835 - (1.015 * asl) - (84.6 * asw);
  return {
    score: Math.min(100, Math.max(0, Math.round(score))),
    wordCount: words.length,
    sentenceCount: sentences.length,
    avgWordsPerSentence: parseFloat(asl.toFixed(1))
  };
};
```

**Suggestion engine**: Implemented as a pure function `getSuggestions(text, score)` that returns an array of suggestion objects. Returns an empty array if score >= 90.

**Data privacy**: The component must include a visible note confirming that text is not stored or transmitted — processed in the browser only. This is important for staff handling case-related content.

**Word substitution list**: Store as a constant array in a separate file `src/pages/Readability/wordList.js` so it can be extended independently:

```javascript
export const WORD_SUBSTITUTIONS = [
  { find: /\butilise\b/gi, replace: 'use' },
  { find: /\bcommence\b/gi, replace: 'start' },
  // ... full list
];
```

---

## Asset Notes

**AfC logo**: The official AfC colour logo PNG should be committed to the repository at `public/assets/afc-logo.png`. It is referenced in the welcome screen as a standard `<img>` tag. Ensure the file is included in the CDK/Amplify deployment so it is served from the same CloudFront distribution as the app.

**Tabler icons**: The project's existing icon library should be confirmed. If Tabler is not already included, add via npm:
```
npm install @tabler/icons-react
```
Use outline variants only (e.g. `IconFileText`, `IconLanguage`, `IconShieldLock`).

---

## Deployment Notes

1. Both changes are frontend-only — no CDK or infrastructure changes required
2. The welcome screen change replaces Amplify's hosted UI; confirm the existing `Auth` configuration in `src/aws-exports.js` does not force redirect to Cognito's hosted domain
3. Test sign-in, sign-out, and account creation flows end to end after deploying the welcome screen
4. Test the readability checker with text scoring below 50, between 50–89, and above 90 to verify all three states render correctly
5. Verify the logo asset is accessible at `/assets/afc-logo.png` after deployment via CloudFront

---

## Out of Scope

- Changes to the Cognito user pool configuration (covered in the ROI & Auth spec)
- Additional readability frameworks (Gunning Fog, SMOG, Kincaid Grade Level)
- File upload to the readability checker (paste/type only in this version)
- Storing or reporting on readability scores
- Automated readability gate before translation submission (future enhancement)

---

## Future Enhancements

- File upload support for the readability checker (PDF, Word) so staff don't need to copy/paste
- Readability score shown inline on the translation submission form as a soft warning
- Side-by-side view showing original and a Claude-simplified version for one-click improvement
- Readability score recorded against each translation job for reporting purposes
- Expansion of the word substitution list via an admin UI