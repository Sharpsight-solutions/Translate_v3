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
	Header,
	ProgressBar,
	SpaceBetween,
	Textarea,
	TokenGroup,
	Input,
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
const MAX_CHUNK_CHARS = 12000; // Keep chunks manageable for Haiku's context

const SYSTEM_PROMPT = `You are a PII redaction specialist working for a children's services organisation called Achieving for Children (AfC). Your task is to identify and redact all personally identifiable information from the provided text.

You must identify and replace:
- Full names of children, parents, family members, and any non-professional individuals
- Addresses, postcodes, and location details that could identify a family
- Phone numbers, email addresses
- Dates of birth and ages (when combined with other identifiers)
- School names, nursery names, GP surgery names
- National Insurance numbers, NHS numbers, case reference numbers
- Any other information that could directly or indirectly identify an individual

Rules:
- Use consistent placeholders throughout: Child A, Child B, Parent 1, Parent 2, Professional 1, etc.
- The same person must always get the same placeholder across the ENTIRE document
- Professional names (social workers, teachers, doctors) should be replaced with role-based placeholders like "Social Worker 1", "Teacher 1"
- Organisation names like "Achieving for Children" should NOT be redacted
- Keep the text readable and coherent after redaction
- Preserve the meaning, structure, and formatting of the document
- Maintain paragraph breaks and any list formatting

EXCLUSIONS (do NOT redact these specific terms):
{exclusions}

CATEGORIES TO REDACT:
{categories}

Return ONLY the redacted text. Do not add explanations, commentary, or preamble.`;

const AI_CATEGORIES = [
	{ id: "names", label: "Names" },
	{ id: "addresses", label: "Addresses & locations" },
	{ id: "contact", label: "Phone & email" },
	{ id: "dates", label: "Dates of birth & ages" },
	{ id: "schools", label: "Schools & services" },
	{ id: "ids", label: "ID numbers (NI, NHS, case refs)" },
	{ id: "indirect", label: "Indirect identifiers" },
];

const SUPPORTED_TYPES = [
	"text/plain",
	"text/html",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export default function RedactionDocument() {
	const [file, setFile] = useState<File | undefined>();
	const [extractedText, setExtractedText] = useState("");
	const [redactedText, setRedactedText] = useState("");
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


	const getSystemPrompt = () => {
		const exclusionText =
			exclusions.length > 0 ? exclusions.join(", ") : "None specified";
		const categoryText = selectedCategories
			.map((id) => AI_CATEGORIES.find((c) => c.id === id)?.label)
			.filter(Boolean)
			.join(", ");

		let prompt = SYSTEM_PROMPT.replace("{exclusions}", exclusionText).replace(
			"{categories}",
			categoryText
		);

		if (customPrompt.trim()) {
			prompt += `\n\nADDITIONAL INSTRUCTIONS FROM USER:\n${customPrompt.trim()}`;
		}

		return prompt;
	};

	const callBedrock = async (text: string): Promise<string> => {
		const session = await fetchAuthSession();
		const credentials = session.credentials;

		if (!credentials) {
			throw new Error("Not authenticated. Please sign in again.");
		}

		const client = new BedrockRuntimeClient({
			region: cfnOutputs.awsRegion,
			credentials: {
				accessKeyId: credentials.accessKeyId,
				secretAccessKey: credentials.secretAccessKey,
				sessionToken: credentials.sessionToken,
			},
		});

		const body = JSON.stringify({
			anthropic_version: "bedrock-2023-05-31",
			max_tokens: 8192,
			messages: [
				{
					role: "user",
					content: text,
				},
			],
			system: getSystemPrompt(),
		});

		const response = await client.send(
			new InvokeModelCommand({
				modelId: MODEL_ID,
				contentType: "application/json",
				accept: "application/json",
				body: new TextEncoder().encode(body),
			})
		);

		const responseBody = JSON.parse(new TextDecoder().decode(response.body));
		return responseBody.content[0].text;
	};

	const handleProcess = async () => {
		if (!file) return;
		setError("");
		setLoading(true);
		setRedactedText("");
		setProgress(0);
		setProgressLabel("Extracting text from document...");

		try {
			// Step 1: Extract text
			const text = await extractTextFromFile(file);
			setExtractedText(text);

			if (
				text === "Could not extract text from this document." ||
				text === "Unsupported file type."
			) {
				setError(text);
				setLoading(false);
				return;
			}

			setProgress(20);
			setProgressLabel("Processing with AI...");

			// Step 2: Split into chunks if needed
			const chunks: string[] = [];
			if (text.length <= MAX_CHUNK_CHARS) {
				chunks.push(text);
			} else {
				// Split at paragraph boundaries
				const paragraphs = text.split(/\n\n+/);
				let currentChunk = "";

				for (const para of paragraphs) {
					if (
						currentChunk.length + para.length + 2 > MAX_CHUNK_CHARS &&
						currentChunk.length > 0
					) {
						chunks.push(currentChunk.trim());
						currentChunk = para;
					} else {
						currentChunk += (currentChunk ? "\n\n" : "") + para;
					}
				}
				if (currentChunk.trim()) {
					chunks.push(currentChunk.trim());
				}
			}

			// Step 3: Process each chunk
			const redactedChunks: string[] = [];
			for (let i = 0; i < chunks.length; i++) {
				const chunkProgress = 20 + ((i + 1) / chunks.length) * 70;
				setProgress(Math.round(chunkProgress));
				setProgressLabel(
					`Processing chunk ${i + 1} of ${chunks.length}...`
				);

				const redacted = await callBedrock(chunks[i]);
				redactedChunks.push(redacted);
			}

			// Step 4: Combine results
			setProgress(95);
			setProgressLabel("Finalising...");
			const finalResult = redactedChunks.join("\n\n");
			setRedactedText(finalResult);
			setProgress(100);
			setProgressLabel("Complete");

			// Log usage
			logRedactionUsage({
				mode: "document",
				wordCount: text.trim().split(/\s+/).length,
				entitiesDetected: 0,
				entitiesRedacted: 0,
				categories: selectedCategories,
			});
		} catch (err: any) {
			console.error("Document redaction error:", err);
			setError(err.message || "An error occurred. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	const handleDownload = () => {
		if (!redactedText) return;
		const originalName = file?.name?.replace(/\.[^.]+$/, "") || "document";
		const originalExt = file?.name?.split(".").pop()?.toLowerCase() || "txt";

		if (originalExt === "docx") {
			// Generate a .docx file from the redacted text
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

	const handleClear = () => {
		setFile(undefined);
		setExtractedText("");
		setRedactedText("");
		setError("");
		setProgress(0);
		setProgressLabel("");
	};

	return (
		<SpaceBetween size="l">
			<Header
				variant="h1"
				description="Upload a document for AI-powered PII redaction using Claude"
			>
				Document Redaction
			</Header>

			<Alert type="info">
				Upload a document and Claude will intelligently redact all personal
				information, including indirect identifiers. The redacted output is
				returned as plain text. Your document text is processed within AfC's
				AWS account via Amazon Bedrock.
			</Alert>

			{/* File Upload */}
			<Container header={<Header variant="h2">1. Upload document</Header>}>
				<FileUpload
					onChange={({ detail }) => {
						setFile(detail.value[0]);
						setRedactedText("");
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
					constraintText="Supported formats: .txt, .html, .docx"
					showFileSize
					showFileLastModified
					multiple={false}
					tokenLimit={1}
				/>
			</Container>

			{/* Categories */}
			<Container
				header={
					<Header variant="h2" description="What should Claude look for?">
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

			{/* Exclusions */}
			<Container
				header={
					<Header
						variant="h2"
						description="Phrases to preserve (e.g. a professional's name)"
					>
						3. Exclusions (optional)
					</Header>
				}
			>
				<SpaceBetween size="m">
					<SpaceBetween direction="horizontal" size="xs">
						<Input
							value={exclusionInput}
							onChange={({ detail }) => setExclusionInput(detail.value)}
							placeholder="e.g. Jane Smith, Achieving for Children"
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
								setExclusions(
									exclusions.filter((_, i) => i !== detail.itemIndex)
								);
							}}
						/>
					)}
				</SpaceBetween>
			</Container>

			{/* Custom Prompt */}
			<Container
				header={
					<Header
						variant="h2"
						description="Give the AI additional context or instructions to guide the redaction"
					>
						4. Additional instructions (optional)
					</Header>
				}
			>
				<Textarea
					value={customPrompt}
					onChange={({ detail }) => setCustomPrompt(detail.value)}
					placeholder="e.g. This is a child protection conference report. Keep the IRO and social worker names visible but redact the family. The school mentioned is relevant context — redact it."
					rows={3}
				/>
			</Container>

			{/* Action */}
			<SpaceBetween direction="horizontal" size="s">
				<Button
					variant="primary"
					onClick={handleProcess}
					loading={loading}
					disabled={!file}
				>
					Process document
				</Button>
				<Button onClick={handleClear} disabled={!file && !redactedText}>
					Clear
				</Button>
			</SpaceBetween>

			{/* Progress */}
			{loading && (
				<ProgressBar
					value={progress}
					additionalInfo={progressLabel}
					status="in-progress"
				/>
			)}

			{/* Error */}
			{error && <Alert type="error">{error}</Alert>}

			{/* Results */}
			{redactedText && (
				<Container
					header={
						<Header variant="h2">4. Redacted output</Header>
					}
				>
					<SpaceBetween size="m">
						<Textarea value={redactedText} readOnly rows={12} />
						<SpaceBetween direction="horizontal" size="s">
							<CopyToClipboard
								copyButtonText="Copy to clipboard"
								copySuccessText="Copied!"
								textToCopy={redactedText}
								variant="button"
							/>
							<Button onClick={handleDownload} iconName="download">
								Download as .{file?.name?.split(".").pop()?.toLowerCase() || "txt"}
							</Button>
						</SpaceBetween>
					</SpaceBetween>
				</Container>
			)}

			{/* Feedback */}
			{redactedText && <FeedbackWidget feature="redaction_document" />}
		</SpaceBetween>
	);
}
