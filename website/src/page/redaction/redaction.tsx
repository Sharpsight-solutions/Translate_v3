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
	Textarea,
	TokenGroup,
	Input,
} from "@cloudscape-design/components";

import {
	ComprehendClient,
	DetectPiiEntitiesCommand,
	PiiEntity,
} from "@aws-sdk/client-comprehend";
import { fetchAuthSession } from "aws-amplify/auth";
import { logRedactionUsage } from "./useRedactionLog";
import FeedbackWidget from "../partial/feedbackWidget";

const cfnOutputs = require("../../cfnOutputs.json");

// PII categories supported by Comprehend
const PII_CATEGORIES = [
	{ id: "NAME", label: "Names", description: "People's names" },
	{ id: "PHONE", label: "Phone numbers", description: "Phone/mobile numbers" },
	{ id: "EMAIL", label: "Email addresses", description: "Email addresses" },
	{ id: "ADDRESS", label: "Addresses", description: "Physical addresses" },
	{
		id: "DATE_TIME",
		label: "Dates",
		description: "Dates including dates of birth",
	},
	{
		id: "UK_NATIONAL_INSURANCE_NUMBER",
		label: "NI numbers",
		description: "National Insurance numbers",
	},
	{
		id: "BANK_ACCOUNT_NUMBER",
		label: "Bank account numbers",
		description: "Bank account numbers",
	},
	{
		id: "BANK_ROUTING",
		label: "Sort codes",
		description: "Bank sort codes",
	},
	{
		id: "CREDIT_DEBIT_NUMBER",
		label: "Card numbers",
		description: "Credit/debit card numbers",
	},
	{ id: "AGE", label: "Ages", description: "Age references" },
	{
		id: "URL",
		label: "URLs",
		description: "Web addresses",
	},
	{
		id: "SSN",
		label: "SSN / ID numbers",
		description: "Social security or ID numbers",
	},
];

interface DetectedEntity {
	type: string;
	text: string;
	beginOffset: number;
	endOffset: number;
	score: number;
}

export default function RedactionTool() {
	const [inputText, setInputText] = useState("");
	const [redactedText, setRedactedText] = useState("");
	const [selectedCategories, setSelectedCategories] = useState<string[]>([
		"NAME",
		"PHONE",
		"EMAIL",
		"ADDRESS",
		"UK_NATIONAL_INSURANCE_NUMBER",
	]);
	const [exclusions, setExclusions] = useState<string[]>([]);
	const [exclusionInput, setExclusionInput] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [detectedCount, setDetectedCount] = useState(0);
	const [redactedCount, setRedactedCount] = useState(0);

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

	const handleRedact = async () => {
		if (!inputText.trim()) return;
		if (selectedCategories.length === 0) {
			setError("Please select at least one PII category to redact.");
			return;
		}

		setError("");
		setLoading(true);
		setRedactedText("");

		try {
			const session = await fetchAuthSession();
			const credentials = session.credentials;

			if (!credentials) {
				setError("Not authenticated. Please sign in again.");
				setLoading(false);
				return;
			}

			const client = new ComprehendClient({
				region: cfnOutputs.awsRegion,
				credentials: {
					accessKeyId: credentials.accessKeyId,
					secretAccessKey: credentials.secretAccessKey,
					sessionToken: credentials.sessionToken,
				},
			});

			// Comprehend has a 100KB limit per request — split if needed
			const maxChunkSize = 99000; // bytes, leaving margin
			const chunks: string[] = [];
			let remaining = inputText;

			while (remaining.length > 0) {
				if (remaining.length <= maxChunkSize) {
					chunks.push(remaining);
					remaining = "";
				} else {
					// Split at a sentence boundary near the limit
					let splitPoint = remaining.lastIndexOf(". ", maxChunkSize);
					if (splitPoint === -1 || splitPoint < maxChunkSize * 0.5) {
						splitPoint = maxChunkSize;
					} else {
						splitPoint += 2; // include the ". "
					}
					chunks.push(remaining.substring(0, splitPoint));
					remaining = remaining.substring(splitPoint);
				}
			}

			// Process each chunk
			let allEntities: DetectedEntity[] = [];
			let offset = 0;

			for (const chunk of chunks) {
				const response = await client.send(
					new DetectPiiEntitiesCommand({
						Text: chunk,
						LanguageCode: "en",
					})
				);

				if (response.Entities) {
					for (const entity of response.Entities) {
						if (
							entity.Type &&
							entity.BeginOffset !== undefined &&
							entity.EndOffset !== undefined &&
							entity.Score !== undefined
						) {
							allEntities.push({
								type: entity.Type,
								text: chunk.substring(entity.BeginOffset, entity.EndOffset),
								beginOffset: entity.BeginOffset + offset,
								endOffset: entity.EndOffset + offset,
								score: entity.Score,
							});
						}
					}
				}
				offset += chunk.length;
			}

			setDetectedCount(allEntities.length);

			// Filter to selected categories only
			let entitiesToRedact = allEntities.filter((e) =>
				selectedCategories.includes(e.type)
			);

			// Apply exclusions — skip entities whose text matches an exclusion
			const lowerExclusions = exclusions.map((ex) => ex.toLowerCase());
			entitiesToRedact = entitiesToRedact.filter(
				(e) => !lowerExclusions.includes(e.text.toLowerCase())
			);

			setRedactedCount(entitiesToRedact.length);

			// Sort by offset descending so we can replace from end to start
			entitiesToRedact.sort((a, b) => b.beginOffset - a.beginOffset);

			// Perform redaction
			let result = inputText;
			for (const entity of entitiesToRedact) {
				const replacement = `[${entity.type.replace(/_/g, " ")}]`;
				result =
					result.substring(0, entity.beginOffset) +
					replacement +
					result.substring(entity.endOffset);
			}

			setRedactedText(result);

			// Log usage
			logRedactionUsage({
				mode: "quick",
				wordCount: inputText.trim().split(/\s+/).length,
				entitiesDetected: allEntities.length,
				entitiesRedacted: entitiesToRedact.length,
				categories: selectedCategories,
			});
		} catch (err: any) {
			console.error("Redaction error:", err);
			setError(
				err.message || "An error occurred during redaction. Please try again."
			);
		} finally {
			setLoading(false);
		}
	};

	const handleClear = () => {
		setInputText("");
		setRedactedText("");
		setError("");
		setDetectedCount(0);
		setRedactedCount(0);
	};

	return (
		<SpaceBetween size="l">
			<Header variant="h1">Redaction Tool</Header>

			<Alert type="info">
				This tool uses AWS Comprehend to detect personally identifiable
				information (PII) in your text. The text is sent to AWS Comprehend
				within AfC's own AWS account for processing — it is not shared with
				any third party.
			</Alert>

			{/* Input */}
			<Container header={<Header variant="h2">1. Paste your text</Header>}>
				<Textarea
					value={inputText}
					onChange={({ detail }) => setInputText(detail.value)}
					placeholder="Paste the text you want to redact..."
					rows={8}
				/>
			</Container>

			{/* PII Categories */}
			<Container
				header={
					<Header
						variant="h2"
						description="Select which types of personal information to redact"
					>
						2. Choose PII categories
					</Header>
				}
			>
				<ColumnLayout columns={3}>
					{PII_CATEGORIES.map((category) => (
						<Checkbox
							key={category.id}
							checked={selectedCategories.includes(category.id)}
							onChange={({ detail }) =>
								handleCategoryToggle(category.id, detail.checked)
							}
							description={category.description}
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
						description="Add specific words or phrases that should NOT be redacted, even if detected as PII"
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
							items={exclusions.map((ex) => ({ label: ex, dismissLabel: `Remove ${ex}` }))}
							onDismiss={({ detail }) => {
								setExclusions(
									exclusions.filter((_, i) => i !== detail.itemIndex)
								);
							}}
						/>
					)}
					{exclusions.length === 0 && (
						<Box color="text-body-secondary" variant="small">
							No exclusions added. All detected PII in selected categories will
							be redacted.
						</Box>
					)}
				</SpaceBetween>
			</Container>

			{/* Action */}
			<SpaceBetween direction="horizontal" size="s">
				<Button
					variant="primary"
					onClick={handleRedact}
					loading={loading}
					disabled={!inputText.trim() || selectedCategories.length === 0}
				>
					Redact PII
				</Button>
				<Button onClick={handleClear} disabled={!inputText && !redactedText}>
					Clear
				</Button>
			</SpaceBetween>

			{/* Error */}
			{error && <Alert type="error">{error}</Alert>}

			{/* Results */}
			{redactedText && (
				<Container
					header={
						<Header
							variant="h2"
							description={`${detectedCount} PII entities detected, ${redactedCount} redacted${exclusions.length > 0 ? `, ${detectedCount - redactedCount} excluded` : ""}`}
						>
							4. Redacted output
						</Header>
					}
				>
					<SpaceBetween size="m">
						<Textarea value={redactedText} readOnly rows={8} />
						<CopyToClipboard
							copyButtonText="Copy redacted text"
							copySuccessText="Copied!"
							textToCopy={redactedText}
							variant="button"
						/>
					</SpaceBetween>
				</Container>
			)}

			{/* Feedback */}
			{redactedText && <FeedbackWidget feature="redaction_quick" />}
		</SpaceBetween>
	);
}
