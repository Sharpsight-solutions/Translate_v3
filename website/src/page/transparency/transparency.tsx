// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import "@cloudscape-design/global-styles/index.css";

import React from "react";

import {
	Box,
	ColumnLayout,
	Container,
	ExpandableSection,
	Header,
	SpaceBetween,
} from "@cloudscape-design/components";

export default function Transparency() {
	return (
		<SpaceBetween size="l">
			<Header
				variant="h1"
				description="How this service works, what technology it uses, and how your data is handled"
			>
				How It Works
			</Header>

			<Container
				header={
					<Header variant="h2">
						Our commitment to transparency
					</Header>
				}
			>
				<Box variant="p">
					This service uses artificial intelligence and cloud technology to
					help you work more efficiently. We believe you should understand
					exactly what happens to your documents and how decisions are made.
					This page explains each feature in plain language — no technical
					jargon.
				</Box>
			</Container>

			{/* Document Translation */}
			<Container
				header={
					<Header variant="h2">
						<span style={{ marginRight: "8px" }}>🌍</span>
						Document Translation
					</Header>
				}
			>
				<SpaceBetween size="m">
					<ExpandableSection headerText="What happens when you upload a document?" defaultExpanded>
						<SpaceBetween size="s">
							<Box variant="p">
								When you upload a document for translation, here's what happens
								step by step:
							</Box>
							<Box variant="ol">
								<li>
									<strong>Upload</strong> — Your file is securely uploaded to
									AfC's private cloud storage (Amazon S3). Only you and the
									system can access it.
								</li>
								<li>
									<strong>Text extraction</strong> — If you uploaded a PDF, the
									system uses Amazon Textract (an AI service) to read the text
									from the document, including scanned pages.
								</li>
								<li>
									<strong>Translation</strong> — The extracted text is sent to
									Amazon Translate, a machine translation service. It translates
									your text into the target language(s) you selected.
								</li>
								<li>
									<strong>Result</strong> — The translated document is saved to
									your private storage and appears in your History for download.
								</li>
								<li>
									<strong>Cleanup</strong> — After 7 days, both the original and
									translated files are automatically deleted.
								</li>
							</Box>
						</SpaceBetween>
					</ExpandableSection>

					<ExpandableSection headerText="What technology powers the translation?">
						<ColumnLayout columns={2} variant="text-grid">
							<div>
								<Box variant="awsui-key-label">Amazon Translate</Box>
								<Box variant="p">
									A neural machine translation service built by Amazon. It uses
									deep learning models trained on millions of translated
									documents to produce natural-sounding translations in over 75
									languages.
								</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Amazon Textract</Box>
								<Box variant="p">
									An AI service that extracts text from scanned documents and
									PDFs. It can read printed text, handwriting, and text within
									images.
								</Box>
							</div>
						</ColumnLayout>
					</ExpandableSection>

					<ExpandableSection headerText="How accurate is it?">
						<Box variant="p">
							Machine translation has improved dramatically in recent years and
							is suitable for most internal communications, letters to families,
							and general documents. However, it's not perfect — nuance, idioms,
							and highly specialised terminology may not translate precisely. For
							legal or medical documents where exact wording is critical, we
							recommend professional human review of the output.
						</Box>
					</ExpandableSection>
				</SpaceBetween>
			</Container>

			{/* Redaction */}
			<Container
				header={
					<Header variant="h2">
						<span style={{ marginRight: "8px" }}>🔒</span>
						AI Redaction
					</Header>
				}
			>
				<SpaceBetween size="m">
					<ExpandableSection headerText="How does AI redaction work?" defaultExpanded>
						<SpaceBetween size="s">
							<Box variant="p">
								The redaction tool uses AI to find and remove personal
								information from your documents. Here's the process:
							</Box>
							<Box variant="ol">
								<li>
									<strong>Analysis</strong> — Your text is sent to Claude (an AI
									assistant made by Anthropic, running within AfC's AWS account).
									Claude reads the text and identifies anything that could
									identify a person — names, addresses, phone numbers, schools,
									and even indirect identifiers like "the family above the chip
									shop."
								</li>
								<li>
									<strong>Suggestions</strong> — The AI returns a list of
									everything it found, with a proposed replacement for each item
									(e.g. "James" → "Child A", "07700 900123" → "[PHONE]").
								</li>
								<li>
									<strong>Your review</strong> — In Review & Approve mode, you
									see every suggestion and decide what to accept or reject. The
									AI doesn't make final decisions — you do.
								</li>
								<li>
									<strong>Output</strong> — Only the items you approved are
									redacted. The result is available to copy or download.
								</li>
							</Box>
						</SpaceBetween>
					</ExpandableSection>

					<ExpandableSection headerText="What AI model is used?">
						<ColumnLayout columns={2} variant="text-grid">
							<div>
								<Box variant="awsui-key-label">Claude 3.7 Sonnet</Box>
								<Box variant="p">
									Made by Anthropic. Claude is designed to be helpful, harmless,
									and honest. It's one of the most capable AI models available
									and excels at understanding context — which is why it can spot
									indirect identifiers that simpler tools miss. Used across all
									redaction modes (Quick Text, Document, and Review &amp; Approve).
								</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">How it's hosted</Box>
								<Box variant="p">
									Claude runs via Amazon Bedrock within AfC's own AWS account in
									the UK (eu-west-2). Your data never leaves AfC's environment
									and is not used to train the AI model.
								</Box>
							</div>
						</ColumnLayout>
					</ExpandableSection>

					<ExpandableSection headerText="Does the AI store my documents?">
						<Box variant="p">
							<strong>No.</strong> When your text is sent to Claude for
							redaction, it is processed in real-time and immediately discarded.
							The AI does not store, learn from, or retain any of your documents.
							Amazon Bedrock (the service that hosts Claude) is configured with
							data privacy controls that prevent your data from being used for
							model training. Your text never leaves AfC's AWS account.
						</Box>
					</ExpandableSection>

					<ExpandableSection headerText="Can the AI make mistakes?">
						<Box variant="p">
							Yes. AI is not infallible. It may occasionally:
						</Box>
						<Box variant="ul">
							<li>Miss an indirect identifier that a human would catch</li>
							<li>Flag something as personal information when it isn't</li>
							<li>
								Use an inconsistent placeholder (though this is rare with Claude
								3.7)
							</li>
						</Box>
						<Box variant="p">
							This is why the <strong>Review & Approve</strong> mode exists — it
							puts you in control. Always review the output before sharing a
							redacted document externally.
						</Box>
					</ExpandableSection>
				</SpaceBetween>
			</Container>

			{/* Readability */}
			<Container
				header={
					<Header variant="h2">
						<span style={{ marginRight: "8px" }}>📊</span>
						Readability Checker
					</Header>
				}
			>
				<SpaceBetween size="m">
					<ExpandableSection headerText="How does the readability checker work?" defaultExpanded>
						<SpaceBetween size="s">
							<Box variant="p">
								The readability checker uses a mathematical formula called the
								<strong> Flesch Reading Ease</strong> score. It measures two
								things:
							</Box>
							<Box variant="ul">
								<li>
									<strong>Sentence length</strong> — shorter sentences are easier
									to read
								</li>
								<li>
									<strong>Word complexity</strong> — words with fewer syllables
									are easier to understand
								</li>
							</Box>
							<Box variant="p">
								The formula combines these into a score from 0 to 100. Higher
								scores mean easier reading. For documents going to residents and
								families, we recommend a score of 60 or above.
							</Box>
							<Box variant="p">
								<strong>Important:</strong> The readability checker runs entirely
								in your browser. Your text is never sent anywhere — it's
								processed locally on your computer. No AI is involved.
							</Box>
						</SpaceBetween>
					</ExpandableSection>
				</SpaceBetween>
			</Container>

			{/* Data & Security */}
			<Container
				header={
					<Header variant="h2">
						<span style={{ marginRight: "8px" }}>🛡️</span>
						Data &amp; Security
					</Header>
				}
			>
				<SpaceBetween size="m">
					<ExpandableSection headerText="Where is my data stored?" defaultExpanded>
						<Box variant="p">
							All data is stored in Amazon Web Services (AWS) in the
							<strong> eu-west-2 (London) </strong> region. This means your
							documents physically reside in data centres in the UK. Data never
							leaves the UK for processing or storage.
						</Box>
					</ExpandableSection>

					<ExpandableSection headerText="Who can see my documents?">
						<Box variant="ul">
							<li>
								<strong>Your translations</strong> — only you can see and
								download your own translations
							</li>
							<li>
								<strong>Administrators</strong> — can see usage statistics (word
								counts, languages, dates) but cannot access the content of your
								documents
							</li>
							<li>
								<strong>No one else</strong> — documents are not accessible to
								AWS, Anthropic, or any third party
							</li>
						</Box>
					</ExpandableSection>

					<ExpandableSection headerText="How long is data kept?">
						<Box variant="ul">
							<li>
								<strong>Uploaded documents</strong> — automatically deleted after
								7 days
							</li>
							<li>
								<strong>Translated outputs</strong> — automatically deleted after
								7 days
							</li>
							<li>
								<strong>Redacted text</strong> — not stored at all (processed in
								your browser or in real-time via AI, then discarded)
							</li>
							<li>
								<strong>Job metadata</strong> — file names, dates, and word
								counts are retained for reporting purposes
							</li>
						</Box>
					</ExpandableSection>

					<ExpandableSection headerText="Is this service accredited?">
						<Box variant="p">
							The service runs on AWS infrastructure which holds ISO 27001, SOC
							2, and Cyber Essentials Plus certifications. The AI models (Claude
							via Amazon Bedrock) are covered by AWS's data processing agreements
							which prohibit the use of customer data for model training.
						</Box>
					</ExpandableSection>
				</SpaceBetween>
			</Container>

			{/* Feedback & Improvement */}
			<Container
				header={<Header variant="h2">Feedback &amp; Continuous Improvement</Header>}
			>
				<Box variant="p">
					When you rate a translation or redaction with 👍 or 👎, this helps
					administrators understand which features are working well and where
					improvements are needed. Your feedback is anonymous — it's stored as a
					rating against the job, not linked to any personal information about
					you. We use this data to prioritise improvements to the service.
				</Box>
			</Container>
		</SpaceBetween>
	);
}
