// Readability calculation utilities — entirely client-side

import { WORD_SUBSTITUTIONS } from "./wordList";

export interface FleschResult {
	score: number;
	gradeLevel: number;
	wordCount: number;
	sentenceCount: number;
	avgWordsPerSentence: number;
}

export interface Suggestion {
	type: "long_sentence" | "complex_word" | "passive_voice";
	message: string;
	detail?: string;
}

export interface ScoreBand {
	label: string;
	status: "target_met" | "needs_work" | "below_target";
	color: string;
}

export function countSyllables(word: string): number {
	word = word.toLowerCase().replace(/[^a-z]/g, "");
	if (!word) return 0;
	if (word.length <= 3) return 1;
	word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
	word = word.replace(/^y/, "");
	const matches = word.match(/[aeiouy]{1,2}/g);
	return matches ? matches.length : 1;
}

export function calculateFlesch(text: string): FleschResult | null {
	const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 2);
	const words = text.match(/\b[a-zA-Z']+\b/g) || [];
	if (!sentences.length || !words.length) return null;

	const syllables = words.reduce((acc, w) => acc + countSyllables(w), 0);
	const asl = words.length / sentences.length;
	const asw = syllables / words.length;
	const score = 206.835 - 1.015 * asl - 84.6 * asw;
	const gradeLevel = 0.39 * asl + 11.8 * asw - 15.59;

	return {
		score: Math.min(100, Math.max(0, Math.round(score))),
		gradeLevel: Math.max(0, parseFloat(gradeLevel.toFixed(1))),
		wordCount: words.length,
		sentenceCount: sentences.length,
		avgWordsPerSentence: parseFloat(asl.toFixed(1)),
	};
}

export function getScoreBand(score: number): ScoreBand {
	if (score >= 90) {
		return {
			label: "Very easy to read — easily understood by an average 11-year-old",
			status: "target_met",
			color: "#16a34a",
		};
	} else if (score >= 80) {
		return {
			label: "Easy to read — conversational English for consumers",
			status: "target_met",
			color: "#22c55e",
		};
	} else if (score >= 70) {
		return {
			label: "Fairly easy to read — understood by 13 to 15-year-olds",
			status: "needs_work",
			color: "#84cc16",
		};
	} else if (score >= 60) {
		return {
			label: "Standard — easily understood by most adults (target for public documents)",
			status: "needs_work",
			color: "#ca8a04",
		};
	} else if (score >= 50) {
		return {
			label: "Fairly difficult — some readers may struggle",
			status: "below_target",
			color: "#ea580c",
		};
	} else if (score >= 30) {
		return {
			label: "Difficult — best understood by university graduates",
			status: "below_target",
			color: "#dc2626",
		};
	} else {
		return {
			label: "Very difficult — best understood by university graduates with specialist knowledge",
			status: "below_target",
			color: "#991b1b",
		};
	}
}

export function getSuggestions(text: string, score: number): Suggestion[] {
	if (score >= 70) return [];

	const suggestions: Suggestion[] = [];
	const maxSuggestions = 6;

	// 1. Long sentences (over 20 words)
	const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 2);
	const longSentences = sentences.filter((s) => {
		const words = s.trim().match(/\b[a-zA-Z']+\b/g) || [];
		return words.length > 20;
	});

	for (const sentence of longSentences.slice(0, 2)) {
		const wordCount = (sentence.trim().match(/\b[a-zA-Z']+\b/g) || []).length;
		const preview =
			sentence.trim().length > 80
				? sentence.trim().substring(0, 80) + "..."
				: sentence.trim();
		suggestions.push({
			type: "long_sentence",
			message: `This sentence has ${wordCount} words. Try splitting it into sentences of 10–15 words.`,
			detail: `"${preview}"`,
		});
		if (suggestions.length >= maxSuggestions) return suggestions;
	}

	// 2. Complex words
	for (const sub of WORD_SUBSTITUTIONS) {
		if (sub.find.test(text)) {
			suggestions.push({
				type: "complex_word",
				message: `Replace "${sub.original}" with "${sub.replace}"`,
			});
			// Reset regex lastIndex
			sub.find.lastIndex = 0;
			if (suggestions.length >= maxSuggestions) return suggestions;
		}
		sub.find.lastIndex = 0;
	}

	// 3. Passive voice detection (simple heuristic)
	const passivePatterns = [
		/\b(?:is|are|was|were|be|been|being)\s+\w+ed\b/gi,
		/\bwill be\s+\w+ed\b/gi,
		/\bhas been\s+\w+ed\b/gi,
		/\bhave been\s+\w+ed\b/gi,
	];

	for (const pattern of passivePatterns) {
		const matches = text.match(pattern);
		if (matches) {
			for (const match of matches.slice(0, 2)) {
				suggestions.push({
					type: "passive_voice",
					message: `Consider rewriting "${match}" in active voice`,
					detail: "Active voice is clearer: say who does the action.",
				});
				if (suggestions.length >= maxSuggestions) return suggestions;
			}
		}
	}

	return suggestions.slice(0, maxSuggestions);
}
