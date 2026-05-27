// Plain English word substitution list
// Extend this list to add more replacements without code changes.

export interface WordSubstitution {
	find: RegExp;
	original: string;
	replace: string;
}

export const WORD_SUBSTITUTIONS: WordSubstitution[] = [
	{ find: /\butilise\b/gi, original: "utilise", replace: "use" },
	{ find: /\bcommence\b/gi, original: "commence", replace: "start" },
	{ find: /\bterminate\b/gi, original: "terminate", replace: "end" },
	{ find: /\bascertain\b/gi, original: "ascertain", replace: "find out" },
	{ find: /\bpurchase\b/gi, original: "purchase", replace: "buy" },
	{
		find: /\bprovide assistance\b/gi,
		original: "provide assistance",
		replace: "help",
	},
	{ find: /\bin order to\b/gi, original: "in order to", replace: "to" },
	{
		find: /\bat this point in time\b/gi,
		original: "at this point in time",
		replace: "now",
	},
	{ find: /\bwith regard to\b/gi, original: "with regard to", replace: "about" },
	{
		find: /\bdue to the fact that\b/gi,
		original: "due to the fact that",
		replace: "because",
	},
	{ find: /\bfacilitate\b/gi, original: "facilitate", replace: "help" },
	{ find: /\bsubsequently\b/gi, original: "subsequently", replace: "then" },
	{ find: /\bprior to\b/gi, original: "prior to", replace: "before" },
	{ find: /\badditionally\b/gi, original: "additionally", replace: "also" },
	{ find: /\bnevertheless\b/gi, original: "nevertheless", replace: "but" },
	{ find: /\bapproximately\b/gi, original: "approximately", replace: "about" },
];
