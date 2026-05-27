// Feedback widget — thumbs up/down for any feature
// Persists submission state in localStorage to prevent duplicate feedback
import React, { useState } from "react";
import { generateClient } from "@aws-amplify/api";
import { v4 as uuid } from "uuid";

interface FeedbackWidgetProps {
	feature: "translation" | "redaction_quick" | "redaction_ai" | "redaction_document" | "redaction_review";
	jobId?: string;
}

const CREATE_FEEDBACK = /* GraphQL */ `
	mutation FeedbackCreate($input: feedback_create_input) {
		feedbackCreate(input: $input) {
			id
		}
	}
`;

function getFeedbackKey(feature: string, jobId?: string): string {
	return `feedback_${feature}_${jobId || "general"}`;
}

function hasSubmittedFeedback(feature: string, jobId?: string): boolean {
	try {
		return localStorage.getItem(getFeedbackKey(feature, jobId)) !== null;
	} catch {
		return false;
	}
}

function markFeedbackSubmitted(feature: string, jobId?: string, rating?: string): void {
	try {
		localStorage.setItem(getFeedbackKey(feature, jobId), rating || "submitted");
	} catch {
		// localStorage not available
	}
}

export default function FeedbackWidget({ feature, jobId }: FeedbackWidgetProps) {
	const alreadySubmitted = hasSubmittedFeedback(feature, jobId);
	const previousRating = alreadySubmitted
		? localStorage.getItem(getFeedbackKey(feature, jobId))
		: null;

	const [submitted, setSubmitted] = useState(alreadySubmitted);
	const [rating, setRating] = useState<string | null>(previousRating);

	const submitFeedback = async (value: "positive" | "negative") => {
		setRating(value);
		setSubmitted(true);
		markFeedbackSubmitted(feature, jobId, value);
		try {
			const client = generateClient({ authMode: "userPool" });
			await client.graphql({
				query: CREATE_FEEDBACK,
				variables: {
					input: {
						id: uuid(),
						feature,
						rating: value,
						jobId: jobId || "",
					},
				},
			});
		} catch (err) {
			console.error("Failed to submit feedback:", err);
		}
	};

	if (submitted) {
		return (
			<div style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
				<span style={{ fontSize: "16px" }}>
					{rating === "positive" ? "👍" : "👎"}
				</span>
			</div>
		);
	}

	return (
		<div style={{ display: "flex", justifyContent: "center", gap: "4px", padding: "4px 0" }}>
			<button
				onClick={() => submitFeedback("positive")}
				aria-label="Thumbs up - yes this was helpful"
				style={{
					background: "none",
					border: "none",
					cursor: "pointer",
					fontSize: "16px",
					padding: "2px 6px",
					borderRadius: "4px",
					transition: "background-color 0.15s",
				}}
				onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f0fdf4")}
				onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
			>
				👍
			</button>
			<button
				onClick={() => submitFeedback("negative")}
				aria-label="Thumbs down - this was not helpful"
				style={{
					background: "none",
					border: "none",
					cursor: "pointer",
					fontSize: "16px",
					padding: "2px 6px",
					borderRadius: "4px",
					transition: "background-color 0.15s",
				}}
				onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#fef2f2")}
				onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
			>
				👎
			</button>
		</div>
	);
}
