# Kiro Spec: Document Translation — ROI, Auth & PDF Enhancements

**Project**: aws-samples/document-translation fork  
**Organisation**: Achieving for Children  
**Author**: Sharp Sight Solutions  
**Version**: 2.0  

---

## Overview

This spec covers four enhancements to the existing Document Translation deployment:

1. Restrict user registration to `achievingforchildren.org.uk` email addresses
2. Add PDF ingestion via AWS Textract (synchronous, 4MB file size limit)
3. Capture source document word count on upload and store it against each job
4. Add an admin dashboard page showing per-job metrics and cumulative ROI against a third-party translation benchmark rate

---

## Requirements

### REQ-01 — Email Domain Restriction

**As an** administrator  
**I want** to restrict self-registration to `achievingforchildren.org.uk` email addresses  
**So that** only AfC staff can create accounts without requiring Google Workspace admin access

**Acceptance Criteria**
- A user attempting to register with any email address other than `@achievingforchildren.org.uk` receives a clear error and is not created in the Cognito user pool
- A user with a valid `@achievingforchildren.org.uk` address can register and sign in as normal
- Existing users are unaffected
- No Google Workspace or SAML configuration is required

---

### REQ-02 — PDF Ingestion

**As a** user  
**I want** to upload PDF documents for translation  
**So that** I don't have to manually convert documents before submitting them

**Acceptance Criteria**
- The file upload UI accepts `.pdf` files in addition to existing supported formats
- PDF files up to 4MB are accepted; files over 4MB are rejected with a clear error message before upload begins
- Uploaded PDFs are converted to plain text via AWS Textract before entering the translation pipeline
- The translated output is returned as plain text (`.txt`) — PDF output is not required
- Scanned/image-based PDFs are supported (Textract OCR handles these)
- If Textract extraction fails, the job is marked as failed with a descriptive error — it must not silently produce an empty translation
- The rest of the pipeline (word count capture, translation, job history) works identically for PDF-sourced jobs

---

### REQ-03 — Source Document Word Count Capture

**As an** administrator  
**I want** the word count of each uploaded source document to be captured automatically  
**So that** I can compare usage against third-party translation pricing

**Acceptance Criteria**
- Word count is captured from the source document before translation begins
- For PDF uploads, word count is captured from the Textract extracted text output (not the original PDF)
- Word count is stored in the DynamoDB job record against the job ID
- Word count reflects the source document (not the translated output)
- Supported file types: `.txt`, `.docx`, `.html`, `.xlsx`, `.pdf` (via Textract conversion)
- If word count extraction fails, the job continues and `wordCount` is stored as `null` — it must not block translation

---

### REQ-04 — Admin Dashboard

**As an** administrator  
**I want** a protected dashboard page in the existing web UI  
**So that** I can view per-job translation metrics and cumulative cost savings vs third-party rates

**Acceptance Criteria**
- Dashboard is only accessible to users in a Cognito `admin` group
- Non-admin users do not see the dashboard link and cannot access the route
- Dashboard displays a table of all translation jobs (all users) with the following columns:
  - Date
  - User (email)
  - Document name
  - Source language
  - Target language(s)
  - Word count
  - Third-party equivalent cost
  - Status
- Summary cards displayed above the table:
  - Total jobs
  - Total words translated
  - Total third-party equivalent cost
  - Estimated AWS Translate cost
  - Net saving
- A date range filter (this month / last month / this quarter / all time) updates both the table and summary cards
- Third-party cost is calculated using the AfC benchmark rate (see Cost Model below)
- Dashboard data is read-only

---

## Cost Model

The third-party benchmark pricing AfC is currently charged:

```
if wordCount <= 300:
    thirdPartyCost = £45.00
else:
    thirdPartyCost = £45.00 + ((wordCount - 300) × £0.15)
```

**Examples**
| Words | Third-Party Cost |
|-------|-----------------|
| 100   | £45.00          |
| 300   | £45.00          |
| 500   | £75.00          |
| 1,000 | £150.00         |
| 2,000 | £300.00         |

AWS Translate pricing for cost comparison: $15 per million characters (~$0.000015/char). Use an average of 5 characters per word as the conversion factor.

Store the rate configuration as environment variables / CDK context values so they can be updated without a code change:

```
AFC_MIN_CHARGE=45
AFC_MIN_WORDS=300
AFC_RATE_PER_WORD=0.15
AWS_TRANSLATE_COST_PER_MILLION_CHARS=15
PDF_MAX_SIZE_BYTES=4194304
```

---

## Technical Approach

### Change 1 — Pre Sign-Up Lambda (REQ-01)

**File to create**: `infrastructure/lib/lambdas/cognitoPreSignUp/index.js`

```javascript
exports.handler = async (event) => {
  const email = event.request.userAttributes.email;
  const domain = email.split('@')[1];

  if (domain !== 'achievingforchildren.org.uk') {
    throw new Error(
      'Registration is restricted to achievingforchildren.org.uk email addresses.'
    );
  }

  return event;
};
```

**CDK wiring**: In the Cognito user pool CDK construct, attach this Lambda as a `preSignUp` trigger:

```typescript
userPool.addTrigger(
  cognito.UserPoolOperation.PRE_SIGN_UP,
  preSignUpFn
);
```

**Scope**: Modify the existing shared auth CDK stack — do not create a new stack.

---

### Change 2 — PDF Conversion Lambda (REQ-02)

**File to create**: `infrastructure/lib/lambdas/pdfConversion/index.js`

**Trigger**: S3 `ObjectCreated` event on the upload bucket, filtered to keys ending in `.pdf` (case-insensitive).

**Logic**:
1. Validate file size — if object exceeds 4MB, update the DynamoDB job record with `jobStatus: FAILED` and a descriptive `jobError` message, then return early
2. Retrieve the PDF from S3 into a buffer
3. Call Textract `DetectDocumentText` (synchronous) with the buffer
4. Concatenate all `LINE` blocks from the Textract response into plain text
5. Write the extracted `.txt` file to the same S3 prefix, replacing `.pdf` in the key with `.txt`
6. Delete the original `.pdf` object from S3 so the translation pipeline only sees the `.txt` file
7. Update the DynamoDB job record `contentType` field to `text/plain`

```javascript
const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const textract = new AWS.Textract();
const dynamodb = new AWS.DynamoDB();

const MAX_SIZE = parseInt(process.env.PDF_MAX_SIZE_BYTES || '4194304');

exports.handler = async (event) => {
  const bucket = event.Records[0].s3.bucket.name;
  const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));
  const sizeBytes = event.Records[0].s3.object.size;

  // Parse job ID from S3 key — adjust path pattern to match actual key structure
  const jobId = key.split('/')[1];

  try {
    // Validate file size
    if (sizeBytes > MAX_SIZE) {
      await updateJobFailed(jobId, `PDF exceeds maximum size of 4MB (uploaded: ${(sizeBytes / 1024 / 1024).toFixed(1)}MB)`);
      return;
    }

    // Retrieve PDF from S3
    const s3Object = await s3.getObject({ Bucket: bucket, Key: key }).promise();

    // Call Textract synchronously
    const textractResult = await textract.detectDocumentText({
      Document: { Bytes: s3Object.Body }
    }).promise();

    // Extract text from LINE blocks
    const extractedText = textractResult.Blocks
      .filter(block => block.BlockType === 'LINE')
      .map(block => block.Text)
      .join('\n');

    if (!extractedText.trim()) {
      await updateJobFailed(jobId, 'Textract could not extract any text from the PDF. The document may be blank or unreadable.');
      return;
    }

    // Write extracted text back to S3
    const txtKey = key.replace(/\.pdf$/i, '.txt');
    await s3.putObject({
      Bucket: bucket,
      Key: txtKey,
      Body: extractedText,
      ContentType: 'text/plain'
    }).promise();

    // Remove original PDF
    await s3.deleteObject({ Bucket: bucket, Key: key }).promise();

    // Update job contentType in DynamoDB
    await dynamodb.updateItem({
      TableName: process.env.JOB_TABLE_NAME,
      Key: { id: { S: jobId } },
      UpdateExpression: 'SET contentType = :ct',
      ExpressionAttributeValues: { ':ct': { S: 'text/plain' } }
    }).promise();

  } catch (err) {
    console.error('PDF conversion failed:', err);
    await updateJobFailed(jobId, 'PDF conversion encountered an unexpected error. Please try again or contact support.');
  }
};

async function updateJobFailed(jobId, message) {
  await dynamodb.updateItem({
    TableName: process.env.JOB_TABLE_NAME,
    Key: { id: { S: jobId } },
    UpdateExpression: 'SET jobStatus = :s, jobError = :e',
    ExpressionAttributeValues: {
      ':s': { S: 'FAILED' },
      ':e': { S: message }
    }
  }).promise();
}
```

**IAM permissions required** (add to Lambda execution role in CDK):
```typescript
pdfConversionFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['textract:DetectDocumentText'],
  resources: ['*'],
}));

uploadBucket.grantReadWrite(pdfConversionFn);
jobTable.grantWriteData(pdfConversionFn);
```

---

### Change 3 — Frontend File Size Validation & PDF Accept (REQ-02)

**Location**: The file upload component in the existing React frontend.

**Changes**:
1. Add `application/pdf` to the accepted MIME types / file extensions on the upload input
2. Add client-side file size validation before the upload is submitted:

```javascript
const MAX_PDF_SIZE = 4 * 1024 * 1024; // 4MB

const handleFileChange = (file) => {
  if (file.type === 'application/pdf' && file.size > MAX_PDF_SIZE) {
    setError(`PDF files must be under 4MB. Your file is ${(file.size / 1024 / 1024).toFixed(1)}MB.`);
    return;
  }
  // proceed with existing upload logic
};
```

The Lambda also validates size server-side (Change 2) as a safety net, but the client-side check gives immediate feedback without consuming bandwidth.

---

### Change 4 — Word Count Lambda (REQ-03)

**File to create**: `infrastructure/lib/lambdas/wordCount/index.js`

**Trigger**: S3 `ObjectCreated` event on the upload bucket, filtered to the source document prefix and **excluding `.pdf` files** (PDFs are handled by the conversion Lambda; word count for PDF-sourced jobs is captured from the `.txt` output file instead).

The S3 trigger filter should match:
- `.txt`, `.html`, `.docx`, `.xlsx` — direct upload
- `.txt` files written by the PDF conversion Lambda (these share the same prefix and extension, so no special handling needed)

**Logic**:
1. Retrieve the uploaded file from S3
2. Extract word count based on content type:
   - `.txt` / `.html`: split on whitespace
   - `.docx`: use `mammoth` to extract text, then count words
   - `.xlsx`: use `xlsx` package to extract cell text, then count words
3. Parse the job ID from the S3 object key
4. Write `wordCount` back to the DynamoDB job record via a direct `UpdateItem` call

```javascript
await dynamodb.updateItem({
  TableName: process.env.JOB_TABLE_NAME,
  Key: { id: { S: jobId } },
  UpdateExpression: 'SET wordCount = :wc',
  ExpressionAttributeValues: { ':wc': { N: String(wordCount) } }
}).promise();
```

**Error handling**: Wrap entire handler in try/catch. On failure, log the error and return — do not throw, so the S3 event does not retry and block the upload flow.

**Dependencies** (Lambda layer or bundled):
- `mammoth` — docx text extraction
- `xlsx` — spreadsheet text extraction

---

### Change 5 — DynamoDB Schema Update (REQ-03)

The existing job record schema needs two new fields:

```json
{
  "wordCount": "<integer | null>",
  "jobError":  "<string | null>"
}
```

Update the AppSync GraphQL schema:
```graphql
type Job {
  # ... existing fields ...
  wordCount: Int
  jobError: String
}
```

`jobError` is used by the PDF conversion Lambda to surface failure reasons in the job history UI. No migration required — DynamoDB is schemaless and existing records return `null` for new fields.

---

### Change 6 — Admin Cognito Group (REQ-04)

Create an `admin` Cognito group in the user pool CDK construct:

```typescript
new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
  userPoolId: userPool.userPoolId,
  groupName: 'admin',
  description: 'Admin users with access to the reporting dashboard',
});
```

Extend the AppSync auth rules on the Job type from `[{ allow: owner }]` to:
```
[{ allow: owner }, { allow: groups, groups: ["admin"] }]
```

First admin user must be manually added to the `admin` group via the AWS Console or CLI after deployment:

```bash
aws cognito-idp admin-add-user-to-group \
  --user-pool-id <USER_POOL_ID> \
  --username <EMAIL> \
  --group-name admin
```

---

### Change 7 — Admin Dashboard Page (REQ-04)

**Location**: New route `/admin` in the existing React/Amplify frontend.

**Access control**: On route load, check Cognito group membership from the current session token. Redirect to home if user is not in the `admin` group.

```javascript
const groups = session.getIdToken().payload['cognito:groups'] || [];
if (!groups.includes('admin')) {
  navigate('/');
}
```

**Data fetching**: New AppSync GraphQL query `listAllJobs` (admin-only resolver) returning all job records including `wordCount` and `jobError`.

**Cost calculation**: Performed client-side using the rate constants:

```javascript
const calcThirdPartyCost = (wordCount) => {
  if (!wordCount) return null;
  const MIN_CHARGE = 45;
  const MIN_WORDS = 300;
  const RATE = 0.15;
  if (wordCount <= MIN_WORDS) return MIN_CHARGE;
  return MIN_CHARGE + ((wordCount - MIN_WORDS) * RATE);
};

const calcAwsCost = (wordCount) => {
  if (!wordCount) return null;
  const CHARS = wordCount * 5;
  return (CHARS / 1_000_000) * 15; // $15 per million chars
};
```

**UI components required**:
- Date range filter (dropdown: This Month / Last Month / This Quarter / All Time)
- Summary cards row (Total Jobs, Total Words, Third-Party Equivalent, AWS Cost, Net Saving)
- Jobs table (sortable by date, paginated) — show `jobError` inline for failed jobs
- Empty state for no results in date range

---

## Event Ordering & Race Condition Notes

The S3-triggered Lambdas (PDF conversion and word count) are independent and fire on different file extensions, so there is no race condition between them:

```
User uploads .pdf
  → pdfConversion Lambda fires (on .pdf)
      → writes .txt to S3
      → deletes .pdf
  → wordCount Lambda fires (on .txt written by pdfConversion)
      → counts words from extracted text
      → writes wordCount to DynamoDB

User uploads .docx / .txt / .html / .xlsx
  → wordCount Lambda fires directly (no conversion step)
      → counts words
      → writes wordCount to DynamoDB
```

The word count Lambda S3 trigger filter must explicitly exclude `.pdf` to prevent it firing on the original upload before conversion is complete.

---

## Deployment Notes

1. Fork `https://github.com/aws-samples/document-translation` to a private repo before making any changes
2. All infrastructure changes are CDK — deploy with `cdk deploy` from the `infrastructure/` directory
3. Environment variables for the cost model and PDF size limit should be set in CDK context (`cdk.json`) or as SSM parameters
4. Both the PDF conversion and word count Lambdas need to be bundled with their npm dependencies at deploy time — confirm the project's existing Lambda bundling approach (esbuild / Lambda layers) and follow the same pattern
5. Textract is a regional service — ensure the Lambda is deployed in the same region as the rest of the stack
6. After deployment, manually add the first admin user to the Cognito `admin` group (see Change 6 above)
7. Test matrix:
   - `.txt` / `.docx` / `.html` / `.xlsx` upload — word count captured, translation succeeds
   - `.pdf` under 4MB (text-based) — converts, word count captured, translation succeeds
   - `.pdf` under 4MB (scanned/image) — Textract OCR extracts text, pipeline succeeds
   - `.pdf` over 4MB — rejected at client with clear error; Lambda also catches as safety net
   - `.pdf` that is blank/unreadable — job marked FAILED with descriptive error

---

## Out of Scope

- SAML / Google Workspace federation
- Returning translated output as PDF
- Modifying the existing translation pipeline behaviour
- Storing calculated cost values in DynamoDB (costs are derived client-side)
- Multi-currency support (GBP assumed throughout)
- Export / download of dashboard data (future enhancement)

---

## Future Enhancements

- CSV export of job data for finance reporting
- Configurable rate card via admin UI (rather than environment variables)
- Per-department or cost-centre breakdown if user metadata is extended
- Email summary report sent monthly to admins
- Async Textract for large PDFs (if the 4MB limit proves too restrictive)
- PDF output option using a post-translation PDF generation step
