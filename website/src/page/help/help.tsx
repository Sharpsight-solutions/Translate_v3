// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import "@cloudscape-design/global-styles/index.css";

import React from "react";

import {
	Alert,
	Box,
	ColumnLayout,
	Container,
	ExpandableSection,
	Header,
	Link,
	SpaceBetween,
} from "@cloudscape-design/components";

export default function Help() {
	return (
		<SpaceBetween size="l">
			<Header
				variant="h1"
				description="Everything you need to know to get started with the Document Translation Service"
			>
				Help &amp; User Guide
			</Header>

			<Alert type="info">
				This service is available to all Achieving for Children staff with an
				@achievingforchildren.org.uk email address. If you have any questions
				not covered here, please contact your line manager or the Digital team.
			</Alert>

			{/* Getting Started */}
			<Container header={<Header variant="h2">Getting Started</Header>}>
				<SpaceBetween size="m">
					<Box variant="p">
						The Document Translation Service helps you translate documents and
						text into other languages quickly and securely. Everything runs
						within AfC's own secure environment — your documents are never
						shared with third parties.
					</Box>
					<Box variant="p">
						Use the navigation menu on the left to move between features. Here's
						what's available:
					</Box>
					<ColumnLayout columns={2} variant="text-grid">
						<div>
							<Box variant="awsui-key-label">Document Translation</Box>
							<Box variant="p">
								Translate documents and text into other languages
							</Box>
						</div>
						<div>
							<Box variant="awsui-key-label">Redaction</Box>
							<Box variant="p">
								Remove personal information from documents before sharing
							</Box>
						</div>
						<div>
							<Box variant="awsui-key-label">Readability Checker</Box>
							<Box variant="p">
								Check how easy your text is to read before translating
							</Box>
						</div>
						<div>
							<Box variant="awsui-key-label">Admin Dashboard</Box>
							<Box variant="p">
								View usage statistics and cost savings (admin only)
							</Box>
						</div>
					</ColumnLayout>
				</SpaceBetween>
			</Container>

			{/* Document Translation */}
			<Container
				header={<Header variant="h2">Document Translation</Header>}
			>
				<SpaceBetween size="m">
					<ExpandableSection
						headerText="Translating a document (Create New)"
						defaultExpanded
					>
						<SpaceBetween size="s">
							<Box variant="ol">
								<li>
									Click <strong>Create New</strong> in the left menu under
									Document Translation
								</li>
								<li>
									Click <strong>Choose file</strong> and select your document.
									Supported formats: Word (.docx), PDF, HTML, Excel (.xlsx),
									PowerPoint (.pptx), and plain text (.txt)
								</li>
								<li>
									Check the <strong>source language</strong> is correct (it
									usually detects this automatically)
								</li>
								<li>
									Select one or more <strong>target languages</strong> — you can
									translate into multiple languages at once
								</li>
								<li>
									Click <strong>Submit</strong>
								</li>
								<li>
									Your translation will appear in your <strong>History</strong>{" "}
									within a few minutes. You'll be redirected there automatically.
								</li>
							</Box>
							<Alert type="info">
								<strong>Tip:</strong> For small documents (under 100KB), the
								service uses fast direct translation which completes in seconds.
								Larger documents go through a background process and may take a
								few minutes.
							</Alert>
						</SpaceBetween>
					</ExpandableSection>

					<ExpandableSection headerText="Quick Text translation">
						<SpaceBetween size="s">
							<Box variant="p">
								For short pieces of text that don't need a file upload:
							</Box>
							<Box variant="ol">
								<li>
									Click <strong>Quick Text</strong> in the left menu
								</li>
								<li>Type or paste your text in the left box</li>
								<li>Select your target language from the dropdown</li>
								<li>
									Click <strong>Submit</strong> — the translation appears
									instantly in the right box
								</li>
								<li>
									Use the <strong>Copy</strong> button to copy the result
								</li>
							</Box>
							<Box variant="p">
								This is ideal for short messages, emails, or quick phrases you
								need translated on the spot.
							</Box>
						</SpaceBetween>
					</ExpandableSection>

					<ExpandableSection headerText="Viewing your translation history">
						<SpaceBetween size="s">
							<Box variant="p">
								Click <strong>History</strong> to see all your previous
								translations. From here you can:
							</Box>
							<Box variant="ul">
								<li>See the status of each translation (completed, in progress, or failed)</li>
								<li>Download completed translations</li>
								<li>See which languages you translated into</li>
							</Box>
						</SpaceBetween>
					</ExpandableSection>

					<ExpandableSection headerText="Supported file formats">
						<ColumnLayout columns={2} variant="text-grid">
							<div>
								<Box variant="awsui-key-label">Documents</Box>
								<Box variant="p">
									Word (.docx), PDF (.pdf), Plain text (.txt), HTML (.html)
								</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Spreadsheets &amp; Presentations</Box>
								<Box variant="p">
									Excel (.xlsx), PowerPoint (.pptx)
								</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Size limits</Box>
								<Box variant="p">
									Most formats: up to 20MB. PDF files: up to 4MB.
								</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">PDF notes</Box>
								<Box variant="p">
									PDFs are converted to text before translation. The output is
									plain text, not a formatted PDF.
								</Box>
							</div>
						</ColumnLayout>
					</ExpandableSection>
				</SpaceBetween>
			</Container>

			{/* Redaction */}
			<Container header={<Header variant="h2">Redaction Tool</Header>}>
				<SpaceBetween size="m">
					<Box variant="p">
						The redaction tool removes personal information (names, addresses,
						phone numbers, etc.) from text before you share it. This is useful
						when you need to share case information without identifying
						individuals.
					</Box>

					<ExpandableSection headerText="Quick Text redaction" defaultExpanded>
						<SpaceBetween size="s">
							<Box variant="p">
								Uses AI (Claude) to intelligently identify personal information,
								including things that simple rules would miss — like school
								names, indirect descriptions, or contextual details that could
								identify someone.
							</Box>
							<Box variant="ol">
								<li>
									Click <strong>Quick Text</strong> under Redaction in the menu
								</li>
								<li>Paste your text into the input box</li>
								<li>Choose what categories to redact</li>
								<li>Add any exclusions (phrases to keep)</li>
								<li>
									Optionally add instructions to guide the AI
								</li>
								<li>
									Click <strong>Redact</strong> for a clean output, or{" "}
									<strong>Audit &amp; Redact</strong> to see exactly what was
									found and why
								</li>
							</Box>
							<Box variant="p">
								The AI uses consistent placeholders throughout — so "James" will
								always become "Child A" everywhere in the text, making the output
								easy to follow.
							</Box>
							<Box variant="p">
								<strong>Best for:</strong> Short pieces of text, case notes,
								emails, and quick checks.
							</Box>
						</SpaceBetween>
					</ExpandableSection>

					<ExpandableSection headerText="Document redaction">
						<SpaceBetween size="s">
							<Box variant="p">
								Upload a whole document for AI-powered redaction:
							</Box>
							<Box variant="ol">
								<li>
									Click <strong>Document</strong> under Redaction
								</li>
								<li>
									Upload your file (.docx, .txt, or .html)
								</li>
								<li>Choose redaction categories and add any exclusions</li>
								<li>
									Click <strong>Process document</strong>
								</li>
								<li>
									Wait for the progress bar to complete — larger documents take
									longer
								</li>
								<li>
									Review the output, then copy or download as a text file
								</li>
							</Box>
							<Box variant="p">
								<strong>Note:</strong> The redacted output is always plain text.
								Formatting from the original document (bold, tables, etc.) is not
								preserved.
							</Box>
						</SpaceBetween>
					</ExpandableSection>

					<ExpandableSection headerText="What are exclusions?">
						<SpaceBetween size="s">
							<Box variant="p">
								Sometimes you need to keep certain names or phrases visible even
								though they look like personal information. For example:
							</Box>
							<Box variant="ul">
								<li>
									A social worker's name that needs to stay in the document
								</li>
								<li>
									An organisation name like "Achieving for Children" or "Kingston
									Hospital"
								</li>
								<li>A specific address that's relevant to the context</li>
							</Box>
							<Box variant="p">
								Type the exact phrase into the exclusions box and click Add. The
								tool will leave those phrases untouched while redacting everything
								else.
							</Box>
						</SpaceBetween>
					</ExpandableSection>
				</SpaceBetween>
			</Container>

			{/* Readability */}
			<Container
				header={<Header variant="h2">Readability Checker</Header>}
			>
				<SpaceBetween size="m">
					<Box variant="p">
						Before translating a document, it's worth checking how easy it is to
						read. Simpler English translates better and is more accessible to
						residents.
					</Box>

					<ExpandableSection headerText="How to use it" defaultExpanded>
						<Box variant="ol">
							<li>
								Click <strong>Readability checker</strong> under Tools
							</li>
							<li>Paste your text into the input box</li>
							<li>
								Click <strong>Check readability</strong>
							</li>
							<li>
								Review your score and the suggestions for improvement
							</li>
						</Box>
					</ExpandableSection>

					<ExpandableSection headerText="Understanding your score">
						<SpaceBetween size="s">
							<Box variant="p">
								The tool gives you a score from 0 to 100. Higher is easier to
								read. For documents going to residents and families, aim for{" "}
								<strong>60 or above</strong>.
							</Box>
							<ColumnLayout columns={2} variant="text-grid">
								<div>
									<Box variant="awsui-key-label">90–100: Very easy</Box>
									<Box variant="p">
										Understood by everyone. Short sentences, simple words.
									</Box>
								</div>
								<div>
									<Box variant="awsui-key-label">70–89: Easy</Box>
									<Box variant="p">
										Conversational. Most people can follow without difficulty.
									</Box>
								</div>
								<div>
									<Box variant="awsui-key-label">60–69: Standard</Box>
									<Box variant="p">
										Suitable for most adults. This is the target for public
										documents.
									</Box>
								</div>
								<div>
									<Box variant="awsui-key-label">Below 60: Difficult</Box>
									<Box variant="p">
										May exclude some readers. Consider simplifying before
										translating.
									</Box>
								</div>
							</ColumnLayout>
						</SpaceBetween>
					</ExpandableSection>

					<ExpandableSection headerText="Tips for improving readability">
						<Box variant="ul">
							<li>
								<strong>Shorten sentences</strong> — aim for 10–15 words per
								sentence
							</li>
							<li>
								<strong>Use simple words</strong> — "use" instead of "utilise",
								"start" instead of "commence"
							</li>
							<li>
								<strong>Use active voice</strong> — "We will send you a letter"
								instead of "A letter will be sent to you"
							</li>
							<li>
								<strong>Break up long paragraphs</strong> — use bullet points
								where possible
							</li>
							<li>
								<strong>Remove filler phrases</strong> — "in order to" → "to",
								"at this point in time" → "now"
							</li>
						</Box>
					</ExpandableSection>

					<ExpandableSection headerText="Privacy">
						<Box variant="p">
							The readability checker works entirely in your browser. Your text
							is never sent anywhere — it's processed locally on your computer.
							It's completely safe to paste case-related content.
						</Box>
					</ExpandableSection>
				</SpaceBetween>
			</Container>

			{/* Your Account */}
			<Container header={<Header variant="h2">Your Account</Header>}>
				<SpaceBetween size="m">
					<ExpandableSection headerText="Signing in" defaultExpanded>
						<SpaceBetween size="s">
							<Box variant="p">
								Sign in with your @achievingforchildren.org.uk email address and
								the password you set when you first registered.
							</Box>
							<Box variant="p">
								If you've forgotten your password, click "Forgot your password?"
								on the sign-in page and follow the instructions to reset it via
								email.
							</Box>
						</SpaceBetween>
					</ExpandableSection>

					<ExpandableSection headerText="Creating an account">
						<SpaceBetween size="s">
							<Box variant="p">
								If you don't have an account yet:
							</Box>
							<Box variant="ol">
								<li>
									Click "New to the service? Create an account" on the sign-in
									page
								</li>
								<li>Enter your @achievingforchildren.org.uk email address</li>
								<li>Choose a password (must include uppercase, lowercase, numbers, and symbols)</li>
								<li>Check your email for a verification code</li>
								<li>Enter the code to confirm your account</li>
								<li>Sign in with your new credentials</li>
							</Box>
							<Box variant="p">
								Only @achievingforchildren.org.uk email addresses can register.
								If you need access and don't have an AfC email, please speak to
								your line manager.
							</Box>
						</SpaceBetween>
					</ExpandableSection>

					<ExpandableSection headerText="Signing out">
						<Box variant="p">
							Click your email address in the top-right corner of the page, then
							select Sign out.
						</Box>
					</ExpandableSection>
				</SpaceBetween>
			</Container>

			{/* FAQ */}
			<Container
				header={<Header variant="h2">Frequently Asked Questions</Header>}
			>
				<SpaceBetween size="m">
					<ExpandableSection headerText="Is my data secure?">
						<Box variant="p">
							Yes. All documents and text are processed within Achieving for
							Children's own secure AWS environment. Nothing is shared with
							external services or third parties. Documents are automatically
							deleted after 7 days.
						</Box>
					</ExpandableSection>

					<ExpandableSection headerText="How accurate are the translations?">
						<Box variant="p">
							The service uses Amazon Translate, which provides high-quality
							machine translation. It's suitable for internal communications,
							letters to families, and general documents. For legal or medical
							documents where precision is critical, we recommend having a
							professional translator review the output.
						</Box>
					</ExpandableSection>

					<ExpandableSection headerText="Can I translate into multiple languages at once?">
						<Box variant="p">
							Yes. When creating a new translation, you can select multiple
							target languages. The service will produce a separate translation
							for each language you choose.
						</Box>
					</ExpandableSection>

					<ExpandableSection headerText="What happens if my translation fails?">
						<Box variant="p">
							If a translation fails, it will show as "FAILED" in your history
							with a description of what went wrong. Common reasons include
							unsupported file formats or files that are too large. Try again
							with a different format, or contact the Digital team if the problem
							persists.
						</Box>
					</ExpandableSection>

					<ExpandableSection headerText="What's the difference between Quick Text, Document, and Review & Approve?">
						<SpaceBetween size="s">
							<Box variant="p">
								<strong>Quick Text</strong> — paste text directly and get an
								instant AI-redacted version. Best for short pieces of text,
								emails, or quick checks.
							</Box>
							<Box variant="p">
								<strong>Document</strong> — upload a file (.docx, .txt, .html)
								and the AI processes the whole document. Best for longer
								documents where you just need the output.
							</Box>
							<Box variant="p">
								<strong>Review &amp; Approve</strong> — upload a file and the AI
								shows you every piece of personal information it found. You
								accept or reject each one before the redaction is applied. Best
								for sensitive documents where you need full control.
							</Box>
						</SpaceBetween>
					</ExpandableSection>

					<ExpandableSection headerText="Who can see my translations?">
						<Box variant="p">
							Only you can see your own translations. Administrators can see
							summary statistics (word counts, languages used) but cannot access
							the content of your documents.
						</Box>
					</ExpandableSection>

					<ExpandableSection headerText="I need help with something not covered here">
						<Box variant="p">
							Please contact the Digital team or speak to your line manager.
							We're happy to help you get the most out of the service.
						</Box>
					</ExpandableSection>
				</SpaceBetween>
			</Container>
		</SpaceBetween>
	);
}
