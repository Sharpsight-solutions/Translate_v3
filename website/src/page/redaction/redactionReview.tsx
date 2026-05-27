// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import "@cloudscape-design/global-styles/index.css";

import React, { useState } from "react";

import {
	Alert,
	Box,
	Button,
	Checkbox,
	ColumnLayout,
	Container,
	CopyToClipboard,
	FileUpload,
	Grid,
	Header,
	Icon,
	Input,
	ProgressBar,
	SpaceBetween,
	StatusIndicator,
	Textarea,
	TokenGroup,
} from "@cloudscape-design/components";

import {
	BedrockRuntimeClient,
	InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { fetchAuthSession } from "aws-amplify/auth";
import { logRedactionUsage } from "./useRedactionLog";
import { extractTextFromFile } from "./extractText";
import FeedbackWidget from "../partial/feedbackWidget";

const cfnOutputs = require("../../cfnOutputs.json");

const MODEL_ID = "anthropic.claude-3-7-sonnet-20250219-v1:0";

const ANALYSIS_PROMPT = `You are a PII redaction specialist working for a children's services organisation called Achieving for Children (AfC).

Analyse the provided text and identify ALL personally identifiable information. Return your findings as a JSON array. Each item must have:
- "original": the exact text to be redacted (as it appears in the document)
- "replacement": the placeholder to use (e.g. "Child A", "Parent 1", "Social Worker 1", "[ADDRESS]", "[PHONE]", "[DOB]")
- "category": one of "Name", "Address", "Phone", "Email", "Date", "School", "ID Number", "Indirect Identifier", "Other"
- "reason": a brief explanation of why this should be redacted

Rules:
- Use consistent placeholders — the same person always gets the same placeholder
- Professional names should use role-based placeholders: "Social Worker 1", "IRO 1", "Teacher 1"
- Organisation names like "Achieving for Children" should NOT be included
- Include indirect identifiers that could identify someone in context
- Be thorough — it's better to flag something that can be restored than to miss it

EXCLUSIONS (do NOT flag these):
{exclusions}

CATEGORIES TO REDACT:
{categories}

{customPrompt}

Return ONLY valid JSON. No markdown, no explanation, no code fences. Just the JSON array.
Example format:
[{"original":"John Smith","replacement":"Child A","category":"Name","reason":"Child's full name"},{"original":"07700 900123","replacement":"[PHONE]","category":"Phone","reason":"Mobile number"}]`;

const AI_CATEGORIES = [
	{ id: "names", label: "Names" },
	{ id: "addresses", label: "Addresses & locations" },
	{ id: "contact", label: "Phone & email" },
	{ id: "dates", label: "Dates of birth & ages" },
	{ id: "schools", label: "Schools & services" },
	{ id: "ids", label: "ID numbers (NI, NHS, case refs)" },
	{ id: "indirect", label: "Indirect identifiers" },
];

interface RedactionItem {
	original: string;
	replacement: string;
	category: string;
	reason: string;
	accepted: boolean;
}

type WorkflowStep = "upload" | "analyse" | "review" | "result";

export default function RedactionReview() {
	const [file, setFile] = useState<File | undefined>();
	const [originalText, setOriginalText] = useState("");
	const [redactionItems, setRedactionItems] = useState<RedactionItem[]>([]);
	const [selectedCategories, setSelectedCategories] = useState<string[]>(
		AI_CATEGORIES.map((c) => c.id)
	);
	const [exclusions, setExclusions] = useState<string[]>([]);
	const [exclusionInput, setExclusionInput] = useState("");
	const [customPrompt, setCustomPrompt] = useState("");
	const [loading, setLoading] = useState(false);
	const [progress, setProgress] = useState(0);
	const [progressLabel, setProgressLabel] = useState("");
	const [error, setError] = useState("");
	const [step, setStep] = useState<WorkflowStep>("upload");
	const [redactedText, setRedactedText] = useState("");

	// Manual addition
	const [manualOriginal, setManualOriginal] = useState("");
	const [manualReplacement, setManualReplacement] = useState("");

	const handleCategoryToggle = (categoryId: string, checked: boolean) => {
		if (checked) {
			setSelectedCategories([...selectedCategories, categoryId]);
		} else {
			setSelectedCategories(selectedCategories.filter((c) => c !== categoryId));
		}
	};

	const addExclusion = () => {
		const trimmed = exclusionInput.trim();
		if (trimmed && !exclusions.includes(trimmed)) {
			setExclusions([...exclusions, trimmed]);
			setExclusionInput("");
		}
	};

	const handleAnalyse = async () => {
		if (!file) return;
		setError("");
		setLoading(true);
		setProgress(0);
		setProgressLabel("Extracting text from document...");

		try {
			const text = await extractTextFromFile(file);
			if (text === "Unsupported file type." || text.length < 10) {
				setError("Could not extract text from this file.");
				setLoading(false);
				return;
			}
			setOriginalText(text);
			setProgress(20);
			setProgressLabel("Analysing document for PII...");

			const session = await fetchAuthSession();
			const credentials = session.credentials;
			if (!credentials) {
				setError("Not authenticated. Please sign in again.");
				setLoading(false);
				return;
			}

			const client = new BedrockRuntimeClient({
				region: cfnOutputs.awsRegion,
				credentials: {
					accessKeyId: credentials.accessKeyId,
					secretAccessKey: credentials.secretAccessKey,
					sessionToken: credentials.sessionToken,
				},
			});

			const exclusionText = exclusions.length > 0 ? exclusions.join(", ") : "None specified";
			const categoryText = selectedCategories
				.map((id) => AI_CATEGORIES.find((c) => c.id === id)?.label)
				.filter(Boolean)
				.join(", ");

			let systemPrompt = ANALYSIS_PROMPT
				.replace("{exclusions}", exclusionText)
				.replace("{categories}", categoryText)
				.replace("{customPrompt}", customPrompt.trim() ? `ADDITIONAL INSTRUCTIONS:\n${customPrompt.trim()}` : "");

			const body = JSON.stringify({
				anthropic_version: "bedrock-2023-05-31",
				max_tokens: 8192,
				messages: [{ role: "user", content: text }],
				system: systemPrompt,
			});

			setProgress(40);
			setProgressLabel("Waiting for AI response...");

			const response = await client.send(
				new InvokeModelCommand({
					modelId: MODEL_ID,
					contentType: "application/json",
					accept: "application/json",
					body: new TextEncoder().encode(body),
				})
			);

			const responseBody = JSON.parse(new TextDecoder().decode(response.body));
			const aiOutput = responseBody.content[0].text;

			setProgress(80);
			setProgressLabel("Processing results...");

			// Parse JSON response
			let items: RedactionItem[] = [];
			try {
				const parsed = JSON.parse(aiOutput);
				items = parsed.map((item: any) => ({
					original: item.original,
					replacement: item.replacement,
					category: item.category,
					reason: item.reason,
					accepted: true, // All accepted by default
				}));
			} catch (parseErr) {
				// Try to extract JSON from the response if it has extra text
				const jsonMatch = aiOutput.match(/\[[\s\S]*\]/);
				if (jsonMatch) {
					const parsed = JSON.parse(jsonMatch[0]);
					items = parsed.map((item: any) => ({
						original: item.original,
						replacement: item.replacement,
						category: item.category,
						reason: item.reason,
						accepted: true,
					}));
				} else {
					setError("AI returned an unexpected format. Please try again.");
					setLoading(false);
					return;
				}
			}

			setRedactionItems(items);
			setProgress(100);
			setProgressLabel("Analysis complete");
			setStep("review");
		} catch (err: any) {
			console.error("Analysis error:", err);
			setError(err.message || "An error occurred during analysis.");
		} finally {
			setLoading(false);
		}
	};

	const handleAddManual = () => {
		if (!manualOriginal.trim() || !manualReplacement.trim()) return;
		setRedactionItems([
			...redactionItems,
			{
				original: manualOriginal.trim(),
				replacement: manualReplacement.trim(),
				category: "Manual",
				reason: "Manually added by user",
				accepted: true,
			},
		]);
		setManualOriginal("");
		setManualReplacement("");
	};

	const handleFinalise = () => {
		// Apply accepted redactions to the original text
		const acceptedItems = redactionItems.filter((item) => item.accepted);

		// Sort by length descending to avoid offset issues with overlapping matches
		const sorted = [...acceptedItems].sort(
			(a, b) => b.original.length - a.original.length
		);

		let result = originalText;
		for (const item of sorted) {
			// Replace all occurrences
			const escaped = item.original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const regex = new RegExp(escaped, "g");
			result = result.replace(regex, item.replacement);
		}

		setRedactedText(result);
		setStep("result");

		// Log usage
		logRedactionUsage({
			mode: "document",
			wordCount: originalText.trim().split(/\s+/).length,
			entitiesDetected: redactionItems.length,
			entitiesRedacted: acceptedItems.length,
			categories: selectedCategories,
		});
	};

	const handleDownload = () => {
		if (!redactedText) return;
		const originalName = file?.name?.replace(/\.[^.]+$/, "") || "document";
		const originalExt = file?.name?.split(".").pop()?.toLowerCase() || "txt";

		if (originalExt === "docx") {
			import("docx").then(({ Document, Packer, Paragraph, TextRun }) => {
				const paragraphs = redactedText.split("\n").map(
					(line) =>
						new Paragraph({
							children: [new TextRun(line)],
						})
				);
				const doc = new Document({
					sections: [{ children: paragraphs }],
				});
				Packer.toBlob(doc).then((blob) => {
					const url = URL.createObjectURL(blob);
					const a = document.createElement("a");
					a.href = url;
					a.download = `${originalName}_REDACTED.docx`;
					a.click();
					URL.revokeObjectURL(url);
				});
			});
		} else {
			const mimeType = originalExt === "html" ? "text/html" : "text/plain";
			const blob = new Blob([redactedText], { type: mimeType });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `${originalName}_REDACTED.${originalExt}`;
			a.click();
			URL.revokeObjectURL(url);
		}
	};

	const handleReset = () => {
		setFile(undefined);
		setOriginalText("");
		setRedactedText("");
		setRedactionItems([]);
		setError("");
		setProgress(0);
		setStep("upload");
	};

	const acceptedCount = redactionItems.filter((i) => i.accepted).length;
	const rejectedCount = redactionItems.filter((i) => !i.accepted).length;

	// STEP: Upload & Configure
	if (step === "upload") {
		return (
			<SpaceBetween size="l">
				<Header
					variant="h1"
					description="Upload a document, review AI suggestions, then approve or reject each redaction before finalising"
				>
					Review &amp; Approve
				</Header>

				<Alert type="info">
					This mode lets you review every redaction before it's applied. The AI
					will suggest what to redact, and you decide what stays and what goes.
				</Alert>

				<Container header={<Header variant="h2">1. Upload document</Header>}>
					<FileUpload
						onChange={({ detail }) => {
							setFile(detail.value[0]);
							setError("");
						}}
						value={file ? [file] : []}
						accept=".txt,.html,.docx"
						i18nStrings={{
							uploadButtonText: (e) => (e ? "Choose files" : "Choose file"),
							dropzoneText: (e) =>
								e ? "Drop files to upload" : "Drop file to upload",
							removeFileAriaLabel: (e) => `Remove file ${e + 1}`,
							limitShowFewer: "Show fewer files",
							limitShowMore: "Show more files",
							errorIconAriaLabel: "Error",
						}}
						constraintText="Supported: .txt, .html, .docx"
						showFileSize
						multiple={false}
						tokenLimit={1}
					/>
				</Container>

				<Container
					header={
						<Header variant="h2" description="What should the AI look for?">
							2. Redaction scope
						</Header>
					}
				>
					<ColumnLayout columns={3}>
						{AI_CATEGORIES.map((category) => (
							<Checkbox
								key={category.id}
								checked={selectedCategories.includes(category.id)}
								onChange={({ detail }) =>
									handleCategoryToggle(category.id, detail.checked)
								}
							>
								{category.label}
							</Checkbox>
						))}
					</ColumnLayout>
				</Container>

				<Container
					header={
						<Header variant="h2" description="Phrases to preserve">
							3. Exclusions (optional)
						</Header>
					}
				>
					<SpaceBetween size="m">
						<SpaceBetween direction="horizontal" size="xs">
							<Input
								value={exclusionInput}
								onChange={({ detail }) => setExclusionInput(detail.value)}
								placeholder="e.g. Jane Smith, Kingston Hospital"
								onKeyDown={({ detail }) => {
									if (detail.key === "Enter") addExclusion();
								}}
							/>
							<Button onClick={addExclusion} disabled={!exclusionInput.trim()}>
								Add
							</Button>
						</SpaceBetween>
						{exclusions.length > 0 && (
							<TokenGroup
								items={exclusions.map((ex) => ({
									label: ex,
									dismissLabel: `Remove ${ex}`,
								}))}
								onDismiss={({ detail }) => {
									setExclusions(exclusions.filter((_, i) => i !== detail.itemIndex));
								}}
							/>
						)}
					</SpaceBetween>
				</Container>

				<Container
					header={
						<Header variant="h2" description="Additional context for the AI">
							4. Instructions (optional)
						</Header>
					}
				>
					<Textarea
						value={customPrompt}
						onChange={({ detail }) => setCustomPrompt(detail.value)}
						placeholder="e.g. This is a LAC review. Keep the IRO name but redact the child and birth family."
						rows={3}
					/>
				</Container>

				{error && <Alert type="error">{error}</Alert>}

				{loading && (
					<ProgressBar
						value={progress}
						additionalInfo={progressLabel}
						status="in-progress"
					/>
				)}

				<Button
					variant="primary"
					onClick={handleAnalyse}
					loading={loading}
					disabled={!file}
				>
					Analyse document
				</Button>
			</SpaceBetween>
		);
	}

	// STEP: Review suggestions
	if (step === "review") {
		return (
			<SpaceBetween size="l">
				<Header
					variant="h1"
					description={`${redactionItems.length} items found — ${acceptedCount} accepted, ${rejectedCount} rejected`}
				>
					Review Redactions
				</Header>

				<Alert type="info">
					Review each suggestion below. Uncheck items you want to keep in the
					final document. You can also add your own redactions at the bottom.
				</Alert>

				{/* Redaction items */}
				<Container
					header={
						<Header
							variant="h2"
							counter={`(${redactionItems.length})`}
							actions={
								<SpaceBetween direction="horizontal" size="s">
									<Button
										onClick={() =>
											setRedactionItems(
												redactionItems.map((i) => ({ ...i, accepted: true }))
											)
										}
									>
										Accept all
									</Button>
									<Button
										onClick={() =>
											setRedactionItems(
												redactionItems.map((i) => ({ ...i, accepted: false }))
											)
										}
									>
										Reject all
									</Button>
								</SpaceBetween>
							}
						>
							Suggested redactions
						</Header>
					}
				>
					<SpaceBetween size="s">
						{redactionItems.map((item, index) => (
							<div
								key={index}
								style={{
									padding: "8px 12px",
									borderRadius: "6px",
									border: `1px solid ${item.accepted ? "#d1fae5" : "#fee2e2"}`,
									backgroundColor: item.accepted ? "#f0fdf4" : "#fef2f2",
								}}
							>
								<SpaceBetween size="xxs">
									<Checkbox
										checked={item.accepted}
										onChange={({ detail }) => {
											const updated = [...redactionItems];
											updated[index] = { ...item, accepted: detail.checked };
											setRedactionItems(updated);
										}}
									>
										<Box variant="span" fontWeight="bold">
											"{item.original}"
										</Box>
										{" → "}
										<Box variant="span" color="text-status-info">
											{item.replacement}
										</Box>
									</Checkbox>
									<Box variant="small" color="text-body-secondary" padding={{ left: "xxl" }}>
										<StatusIndicator type={item.accepted ? "success" : "stopped"}>
											{item.category}
										</StatusIndicator>
										{" — "}
										{item.reason}
									</Box>
								</SpaceBetween>
							</div>
						))}
					</SpaceBetween>
				</Container>

				{/* Add manual redaction */}
				<Container
					header={
						<Header
							variant="h2"
							description="Add something the AI missed"
						>
							Add custom redaction
						</Header>
					}
				>
					<SpaceBetween direction="horizontal" size="s">
						<Input
							value={manualOriginal}
							onChange={({ detail }) => setManualOriginal(detail.value)}
							placeholder="Text to redact"
						/>
						<Input
							value={manualReplacement}
							onChange={({ detail }) => setManualReplacement(detail.value)}
							placeholder="Replace with (e.g. Child B)"
						/>
						<Button
							onClick={handleAddManual}
							disabled={!manualOriginal.trim() || !manualReplacement.trim()}
						>
							Add
						</Button>
					</SpaceBetween>
				</Container>

				{/* Actions */}
				<SpaceBetween direction="horizontal" size="s">
					<Button variant="primary" onClick={handleFinalise}>
						Finalise redaction ({acceptedCount} items)
					</Button>
					<Button onClick={() => setStep("upload")}>Back</Button>
				</SpaceBetween>
			</SpaceBetween>
		);
	}

	// STEP: Result — side by side
	if (step === "result") {
		return (
			<SpaceBetween size="l">
				<Header
					variant="h1"
					description={`${acceptedCount} redactions applied`}
				>
					Redaction Complete
				</Header>

				<Grid
					gridDefinition={[
						{ colspan: { default: 6 } },
						{ colspan: { default: 6 } },
					]}
				>
					<Container header={<Header variant="h3">Original (redacted items highlighted)</Header>}>
						<div
							style={{
								maxHeight: "500px",
								overflow: "auto",
								whiteSpace: "pre-wrap",
								fontFamily: "monospace",
								fontSize: "13px",
								lineHeight: "1.6",
								padding: "8px",
								backgroundColor: "#fefefe",
								borderRadius: "4px",
							}}
							dangerouslySetInnerHTML={{
								__html: (() => {
									// Highlight accepted redaction items in the original text
									const accepted = redactionItems
										.filter((i) => i.accepted)
										.sort((a, b) => b.original.length - a.original.length);
									let html = originalText
										.replace(/&/g, "&amp;")
										.replace(/</g, "&lt;")
										.replace(/>/g, "&gt;");
									for (const item of accepted) {
										const escaped = item.original
											.replace(/&/g, "&amp;")
											.replace(/</g, "&lt;")
											.replace(/>/g, "&gt;")
											.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
										const regex = new RegExp(escaped, "g");
										html = html.replace(
											regex,
											`<mark style="background-color: #fecaca; padding: 1px 3px; border-radius: 2px;" title="${item.replacement}">${item.original.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</mark>`
										);
									}
									return html;
								})(),
							}}
						/>
					</Container>

					<Container header={<Header variant="h3">Redacted</Header>}>
						<div
							style={{
								maxHeight: "500px",
								overflow: "auto",
								whiteSpace: "pre-wrap",
								fontFamily: "monospace",
								fontSize: "13px",
								lineHeight: "1.6",
								padding: "8px",
								backgroundColor: "#f0fdf4",
								borderRadius: "4px",
							}}
							dangerouslySetInnerHTML={{
								__html: (() => {
									// Highlight placeholders in the redacted text
									let html = redactedText
										.replace(/&/g, "&amp;")
										.replace(/</g, "&lt;")
										.replace(/>/g, "&gt;");
									// Highlight all placeholders like [NAME], Child A, Parent 1, etc.
									html = html.replace(
										/(\[[\w\s]+\]|Child [A-Z]|Parent \d+|Professional \d+|Social Worker \d+|Teacher \d+|IRO \d+)/g,
										'<mark style="background-color: #bbf7d0; padding: 1px 3px; border-radius: 2px;">$1</mark>'
									);
									return html;
								})(),
							}}
						/>
					</Container>
				</Grid>

				<SpaceBetween direction="horizontal" size="s">
					<CopyToClipboard
						copyButtonText="Copy redacted text"
						copySuccessText="Copied!"
						textToCopy={redactedText}
						variant="button"
					/>
					<Button onClick={handleDownload} iconName="download">
						Download as .{file?.name?.split(".").pop()?.toLowerCase() || "txt"}
					</Button>
					<Button onClick={handleReset}>Start over</Button>
				</SpaceBetween>

				<FeedbackWidget feature="redaction_review" />
			</SpaceBetween>
		);
	}

	return null;
}
