// Animated progress bar for jobs being processed
// Shows estimated progress based on elapsed time vs estimated duration
import React, { useEffect, useState } from "react";
import { Box, ProgressBar } from "@cloudscape-design/components";

interface ProcessingProgressProps {
	createdAt: number; // epoch seconds
	estimatedDurationSeconds?: number; // default 120 (2 minutes)
}

export default function ProcessingProgress({
	createdAt,
	estimatedDurationSeconds = 120,
}: ProcessingProgressProps) {
	const [progress, setProgress] = useState(0);

	useEffect(() => {
		const updateProgress = () => {
			const now = Math.floor(Date.now() / 1000);
			const elapsed = now - createdAt;
			// Cap at 95% — only jumps to 100% when actually complete
			const pct = Math.min(95, Math.round((elapsed / estimatedDurationSeconds) * 100));
			setProgress(pct);
		};

		updateProgress();
		const interval = setInterval(updateProgress, 3000);
		return () => clearInterval(interval);
	}, [createdAt, estimatedDurationSeconds]);

	const remaining = Math.max(
		0,
		estimatedDurationSeconds - (Math.floor(Date.now() / 1000) - createdAt)
	);
	const remainingLabel =
		remaining > 60
			? `~${Math.ceil(remaining / 60)} min remaining`
			: remaining > 0
				? `~${remaining}s remaining`
				: "Finishing up...";

	return (
		<Box>
			<ProgressBar
				value={progress}
				additionalInfo={remainingLabel}
				status="in-progress"
			/>
		</Box>
	);
}
