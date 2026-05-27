// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import "@cloudscape-design/global-styles/index.css";

import React, { useState } from "react";

import {
	Alert,
	Box,
	Button,
	ColumnLayout,
	Container,
	Header,
	ProgressBar,
	SpaceBetween,
	Textarea,
} from "@cloudscape-design/components";

import {
	calculateFlesch,
	FleschResult,
	getScoreBand,
	getSuggestions,
	Suggestion,
} from "./readabilityUtils";

export default function ReadabilityChecker() {
	const [text, setText] = useState("");
	const [result, setResult] = useState<FleschResult | null>(null);
	const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
	const [hasChecked, setHasChecked] = useState(false);

	const handleCheck = () => {
		const fleschResult = calculateFlesch(text);
		setResult(fleschResult);
		if (fleschResult) {
			setSuggestions(getSuggestions(text, fleschResult.score));
		} else {
			setSuggestions([]);
		}
		setHasChecked(true);
	};

	const handleClear = () => {
		setText("");
		setResult(null);
		setSuggestions([]);
		setHasChecked(false);
	};

	const scoreBand = result ? getScoreBand(result.score) : null;

	const getSuggestionIcon = (type: Suggestion["type"]) => {
		switch (type) {
			case "long_sentence":
				return "✂️";
			case "complex_word":
				return "📝";
			case "passive_voice":
				return "🔄";
		}
	};

	return (
		<SpaceBetween size="l">
			<Header variant="h1">Readability Checker</Header>

			{/* Privacy notice */}
			<Alert type="info">
				Your text is processed entirely in your browser. Nothing is stored or
				sent to any external service. It is safe to paste case-related content.
				{" "}
				<a
					href="https://readable.com/readability/flesch-reading-ease-flesch-kincaid-grade-level/"
					target="_blank"
					rel="noopener noreferrer"
				>
					Learn more about readability scoring
				</a>
			</Alert>

			{/* Input */}
			<Container header={<Header variant="h2">Enter text to check</Header>}>
				<SpaceBetween size="m">
					<Textarea
						value={text}
						onChange={({ detail }) => setText(detail.value)}
						placeholder="Paste or type the text you want to check..."
						rows={10}
					/>
					<SpaceBetween direction="horizontal" size="s">
						<Button
							variant="primary"
							onClick={handleCheck}
							disabled={!text.trim()}
						>
							Check readability
						</Button>
						<Button variant="normal" onClick={handleClear} disabled={!text}>
							Clear
						</Button>
					</SpaceBetween>
				</SpaceBetween>
			</Container>

			{/* Results */}
			{hasChecked && result && scoreBand && (
				<>
					{/* Score display */}
					<Container header={<Header variant="h2">Results</Header>}>
						<SpaceBetween size="l">
							{/* Score and band */}
							<Box>
								<Box variant="h1" fontSize="display-l" textAlign="center">
									{result.score}
								</Box>
								<Box textAlign="center" color="text-body-secondary">
									Flesch Reading Ease Score
								</Box>
							</Box>

							<ProgressBar
								value={result.score}
								additionalInfo={scoreBand.label}
								status={
									scoreBand.status === "target_met" ? "success" : "error"
								}
								description="Target: 60+ for public documents, 70+ for easy reading"
							/>

							{/* Metrics */}
							<ColumnLayout columns={4} variant="text-grid">
								<div>
									<Box variant="awsui-key-label">Word count</Box>
									<Box variant="p">{result.wordCount.toLocaleString()}</Box>
								</div>
								<div>
									<Box variant="awsui-key-label">Sentence count</Box>
									<Box variant="p">{result.sentenceCount}</Box>
								</div>
								<div>
									<Box variant="awsui-key-label">
										Average words per sentence
									</Box>
									<Box variant="p">{result.avgWordsPerSentence}</Box>
								</div>
								<div>
									<Box variant="awsui-key-label">
										Grade level (Flesch-Kincaid)
									</Box>
									<Box variant="p">{result.gradeLevel}</Box>
								</div>
							</ColumnLayout>

							{/* Target met message */}
							{scoreBand.status === "target_met" && (
								<Alert type="success">
									This text meets the readability target. It should be easily
									understood by most adults.
								</Alert>
							)}
						</SpaceBetween>
					</Container>

					{/* Suggestions */}
					{suggestions.length > 0 && (
						<Container
							header={
								<Header
									variant="h2"
									description="Address these to improve your score towards the target of 60+"
								>
									Suggestions
								</Header>
							}
						>
							<ColumnLayout columns={2} variant="text-grid">
								{suggestions.map((suggestion, index) => (
									<div key={index}>
										<Box variant="p" fontWeight="bold">
											<span aria-hidden="true">
												{getSuggestionIcon(suggestion.type)}
											</span>{" "}
											{suggestion.message}
										</Box>
										{suggestion.detail && (
											<Box
												variant="small"
												color="text-body-secondary"
											>
												{suggestion.detail}
											</Box>
										)}
									</div>
								))}
							</ColumnLayout>
						</Container>
					)}
				</>
			)}

			{/* No result state */}
			{hasChecked && !result && (
				<Alert type="warning">
					Could not calculate a score. Please enter at least one complete
					sentence with more than a few words.
				</Alert>
			)}
		</SpaceBetween>
	);
}
