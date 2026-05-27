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
	Header,
	SpaceBetween,
	Tabs,
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
import FeedbackWidget from "../partial/feedbackWidget";

const cfnOutputs = require("../../cfnOutputs.json");

const MODEL_ID = "anthropic.claude-3-7-sonnet-20250219-v1:0";

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
- The same person must always get the same placeholder
- Professional names (social workers, teachers, doctors) should be replaced with role-based placeholders like "Social Worker 1", "Teacher 1"
- Organisation names like "Achieving for Children" should NOT be redacted
- Keep the text readable and coherent after redaction
- Preserve the meaning and structure of the document

EXCLUSIONS (do NOT redact these specific terms even if they appear to be PII):
{exclusions}

CATEGORIES TO REDACT:
{categories}

Return ONLY the redacted text. Do not add explanations or commentary.`;

const AUDIT_PROMPT = `You are a PII redaction specialist working for a children's services organisation called Achieving for Children (AfC). Analyse the provided text and list ALL personally identifiable information found.

For each item found, provide:
- The original text
- The category (Name, Address, Phone, Email, Date of Birth, School, ID Number, Indirect Identifier, etc.)
- Your confidence level (High, Medium, Low)
- The replacement you would use

EXCLUSIONS (do NOT flag these):
{exclusions}

Format your response as a clear list. Then provide the fully redacted version of the text below the list, separated by "---REDACTED VERSION---".`;

const AI_CATEGORIES = [
	{ id: "names", label: "Names", checked: true },
	{ id: "addresses", label: "Addresses & locations", checked: true },
	{ id: "contact", label: "Phone & email", checked: true },
	{ id: "dates", label: "Dates of birth & ages", checked: true },
	{ id: "schools", label: "Schools & services", checked: true },
	{ id: "ids", label: "ID numbers (NI, NHS, case refs)", checked: true },
	{ id: "indirect", label: "Indirect identifiers", checked: true },
];

export default function RedactionAi() {
	const [inputText, setInputText] = useState("");
	const [redactedText, setRedactedText] = useState("");
	const [auditOutput, setAuditOutput] = useState("");
	const [selectedCategories, setSelectedCategories] = useState<string[]>(
		AI_CATEGORIES.map((c) => c.id)
	);
	const [exclusions, setExclusions] = useState<string[]>([]);
	const [exclusionInput, setExclusionInput] = useState("");
	const [customPrompt, setCustomPrompt] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [activeTab, setActiveTab] = useState("redact");

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

	const callBedrock = async (prompt: string): Promise<string> => {
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
					content: prompt,
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

	const getSystemPrompt = () => {
		const exclusionText =
			exclusions.length > 0
				? exclusions.join(", ")
				: "None specified";
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

	const handleRedact = async () => {
		if (!inputText.trim()) return;
		setError("");
		setLoading(true);
		setRedactedText("");

		try {
			const result = await callBedrock(inputText);
			setRedactedText(result);

			// Log usage
			logRedactionUsage({
				mode: "ai",
				wordCount: inputText.trim().split(/\s+/).length,
				entitiesDetected: 0,
				entitiesRedacted: 0,
				categories: selectedCategories,
			});
		} catch (err: any) {
			console.error("AI Redaction error:", err);
			setError(err.message || "An error occurred. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	const handleAudit = async () => {
		if (!inputText.trim()) return;
		setError("");
		setLoading(true);
		setAuditOutput("");

		try {
			const exclusionText =
				exclusions.length > 0 ? exclusions.join(", ") : "None specified";

			const auditSystemPrompt = AUDIT_PROMPT.replace(
				"{exclusions}",
				exclusionText
			);

			const session = await fetchAuthSession();
			const credentials = session.credentials;

			if (!credentials) {
				throw new Error("Not authenticated. Please sign in again.");
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

			const body = JSON.stringify({
				anthropic_version: "bedrock-2023-05-31",
				max_tokens: 8192,
				messages: [
					{
						role: "user",
						content: inputText,
					},
				],
				system: auditSystemPrompt,
			});

			const response = await client.send(
				new InvokeModelCommand({
					modelId: MODEL_ID,
					contentType: "application/json",
					accept: "application/json",
					body: new TextEncoder().encode(body),
				})
			);

			const responseBody = JSON.parse(
				new TextDecoder().decode(response.body)
			);
			const output = responseBody.content[0].text;

			// Split audit and redacted version if present
			if (output.includes("---REDACTED VERSION---")) {
				const parts = output.split("---REDACTED VERSION---");
				setAuditOutput(parts[0].trim());
				setRedactedText(parts[1].trim());
			} else {
				setAuditOutput(output);
			}
		} catch (err: any) {
			console.error("AI Audit error:", err);
			setError(err.message || "An error occurred. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	const handleClear = () => {
		setInputText("");
		setRedactedText("");
		setAuditOutput("");
		setError("");
	};

	return (
		<SpaceBetween size="l">
			<Header
				variant="h1"
				description="Paste text for AI-powered redaction using Claude"
			>
				Quick Text Redaction
			</Header>

			<Alert type="info">
				This tool uses Amazon Bedrock (Claude Haiku) within AfC's AWS account
				to intelligently identify and redact PII, including indirect identifiers
				that rule-based tools miss. Text is processed within your AWS account
				and is not stored by the AI model.
			</Alert>

			{/* Input */}
			<Container header={<Header variant="h2">1. Paste your text</Header>}>
				<Textarea
					value={inputText}
					onChange={({ detail }) => setInputText(detail.value)}
					placeholder="Paste case notes, reports, or any text containing personal information..."
					rows={10}
				/>
			</Container>

			{/* Categories */}
			<Container
				header={
					<Header
						variant="h2"
						description="Select what the AI should look for and redact"
					>
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
						description="Phrases the AI should leave unredacted (e.g. a professional's name that needs to remain visible)"
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
							placeholder="e.g. Jane Smith, St Mary's School"
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
						description="Give the AI additional context or instructions to guide the redaction (e.g. 'This is a child protection conference report — redact the child and family but keep professional names')"
					>
						4. Additional instructions (optional)
					</Header>
				}
			>
				<Textarea
					value={customPrompt}
					onChange={({ detail }) => setCustomPrompt(detail.value)}
					placeholder="e.g. This document is about a fostering placement. The foster carer's name should be kept but the child and birth family should be fully redacted. Pay special attention to school names and GP surgeries mentioned."
					rows={3}
				/>
			</Container>

			{/* Actions */}
			<SpaceBetween direction="horizontal" size="s">
				<Button
					variant="primary"
					onClick={handleRedact}
					loading={loading}
					disabled={!inputText.trim()}
				>
					Redact
				</Button>
				<Button
					onClick={handleAudit}
					loading={loading}
					disabled={!inputText.trim()}
				>
					Audit &amp; Redact
				</Button>
				<Button onClick={handleClear} disabled={!inputText && !redactedText}>
					Clear
				</Button>
			</SpaceBetween>

			{/* Error */}
			{error && <Alert type="error">{error}</Alert>}

			{/* Results */}
			{(redactedText || auditOutput) && (
				<Container header={<Header variant="h2">4. Results</Header>}>
					<Tabs
						activeTabId={activeTab}
						onChange={({ detail }) => setActiveTab(detail.activeTabId)}
						tabs={[
							{
								id: "redact",
								label: "Redacted text",
								content: redactedText ? (
									<SpaceBetween size="m">
										<Textarea value={redactedText} readOnly rows={10} />
										<CopyToClipboard
											copyButtonText="Copy redacted text"
											copySuccessText="Copied!"
											textToCopy={redactedText}
											variant="button"
										/>
									</SpaceBetween>
								) : (
									<Box color="text-body-secondary">
										Click "Redact" to generate the redacted output.
									</Box>
								),
							},
							{
								id: "audit",
								label: "Audit trail",
								content: auditOutput ? (
									<SpaceBetween size="m">
										<Box variant="pre">{auditOutput}</Box>
										<CopyToClipboard
											copyButtonText="Copy audit"
											copySuccessText="Copied!"
											textToCopy={auditOutput}
											variant="button"
										/>
									</SpaceBetween>
								) : (
									<Box color="text-body-secondary">
										Click "Audit &amp; Redact" to see what PII was detected and
										why.
									</Box>
								),
							},
						]}
					/>
				</Container>
			)}

			{/* Feedback */}
			{redactedText && <FeedbackWidget feature="redaction_ai" />}
		</SpaceBetween>
	);
}
