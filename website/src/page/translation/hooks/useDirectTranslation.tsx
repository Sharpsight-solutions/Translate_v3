// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useState } from "react";

import { downloadFile } from "../util/downloadFile";
import { translateDocument } from "../util/translateDocument";
import { verifyAndRefineTranslation } from "../../../util/translationQuality";

interface TranslationProgress {
	[key: string]: {
		status: "pending" | "translating" | "verifying" | "refining" | "completed" | "error";
		error?: string;
		usedTerminology?: boolean;
		qualityScore?: number;
	};
}

export function useDirectTranslation() {
	const [isTranslating, setIsTranslating] = useState<boolean>(false);
	const [progress, setProgress] = useState<TranslationProgress>({});
	const [completedCount, setCompletedCount] = useState<number>(0);
	const [totalCount, setTotalCount] = useState<number>(0);
	const [hasError, setHasError] = useState<boolean>(false);

	/**
	 * Translates a document directly using the TranslateDocumentCommand
	 * and downloads the results for each target language
	 */
	const translateDocumentDirectly = async (
		file: File,
		sourceLanguage: string,
		targetLanguages: string[]
	): Promise<boolean> => {
		if (!file || targetLanguages.length === 0) {
			return false;
		}

		try {
			setIsTranslating(true);
			setCompletedCount(0);
			setTotalCount(targetLanguages.length);
			setHasError(false);

			// Initialize progress tracking for each target language
			const initialProgress: TranslationProgress = {};
			targetLanguages.forEach((lang) => {
				initialProgress[lang] = { status: "pending" };
			});
			setProgress(initialProgress);

			// Process each target language sequentially
			for (const targetLang of targetLanguages) {
				try {
					// Update status to translating
					setProgress((prev) => ({
						...prev,
						[targetLang]: { status: "translating" },
					}));

					// Call the translation service with terminology lookup
					const result = await translateDocument({
						sourceLanguage,
						targetLanguage: targetLang,
						document: file,
					});

					// Quality verification for text-based files
					let finalContent = result.translatedContent;
					let qualityScore = -1;

					const textTypes = [
						"text/plain",
						"text/html",
						"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
					];

					if (textTypes.includes(file.type)) {
						try {
							setProgress((prev) => ({
								...prev,
								[targetLang]: { status: "verifying" },
							}));

							const originalText = await file.text();
							const translatedBlob = result.translatedContent;
							const translatedText = await translatedBlob.text();

							const qualityResult = await verifyAndRefineTranslation(
								originalText,
								translatedText,
								sourceLanguage,
								targetLang,
								95
							);

							qualityScore = qualityResult.score;

							if (qualityResult.refinedTranslation) {
								setProgress((prev) => ({
									...prev,
									[targetLang]: { status: "refining" },
								}));
								finalContent = new Blob([qualityResult.refinedTranslation], {
									type: file.type,
								});
							}
						} catch (qualityErr) {
							// Don't block the download if quality check fails
							console.error("Quality check failed:", qualityErr);
						}
					}

					// Generate filename with language code
					const fileNameParts = file.name.split(".");
					const extension = fileNameParts.pop() || "";
					const baseName = fileNameParts.join(".");
					const downloadFileName = `${baseName}_${targetLang}.${extension}`;

					// Download the translated file
					downloadFile(finalContent, downloadFileName, file.type);

					// Update progress with terminology usage info
					setProgress((prev) => ({
						...prev,
						[targetLang]: {
							status: "completed",
							usedTerminology: result.usedTerminology,
							qualityScore,
						},
					}));
					setCompletedCount((prev) => prev + 1);
				} catch (error) {
					console.error(`Error translating to ${targetLang}:`, error);
					setProgress((prev) => ({
						...prev,
						[targetLang]: {
							status: "error",
							error: error instanceof Error ? error.message : "Unknown error",
						},
					}));
					setHasError(true);
				}
			}

			return !hasError;
		} catch (error) {
			console.error("Error in direct translation process:", error);
			setHasError(true);
			return false;
		} finally {
			setIsTranslating(false);
		}
	};

	return {
		translateDocumentDirectly,
		isTranslating,
		progress,
		completedCount,
		totalCount,
		hasError,
	};
}
