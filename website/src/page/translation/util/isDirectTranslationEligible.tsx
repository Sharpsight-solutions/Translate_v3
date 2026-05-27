// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Checks if a file is eligible for direct translation using TranslateDocumentCommand
 * Criteria:
 * 1. File size is less than 100,000 bytes
 * 2. Either source or at least one target language is English ('en')
 * 3. File type is supported by TranslateDocument API
 */

const DIRECT_TRANSLATION_SUPPORTED_TYPES = [
	"text/plain",
	"text/html",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/x-xliff+xml",
];

export function isDirectTranslationEligible(
	file: File | undefined,
	sourceLanguage: string,
	targetLanguages: string[]
): boolean {
	if (!file) {
		return false;
	}

	// Check file type is supported for direct translation (PDF is NOT supported)
	const isFileTypeEligible = DIRECT_TRANSLATION_SUPPORTED_TYPES.includes(file.type);

	// Check file size (less than 100,000 bytes)
	const isFileSizeEligible = file.size < 100000;

	// Check if source language is English
	const isSourceEnglish = sourceLanguage === "en";

	// Check if any target language is English
	const isAnyTargetEnglish = targetLanguages.includes("en");

	// Return true if all criteria met
	return isFileTypeEligible && isFileSizeEligible && (isSourceEnglish || isAnyTargetEnglish);
}
