// Utility to log redaction usage to DynamoDB via AppSync
import { generateClient } from "@aws-amplify/api";
import { v4 as uuid } from "uuid";
import { redactionCreateLog } from "../../graphql/mutations";

export interface RedactionLogEntry {
	mode: "quick" | "ai" | "document";
	wordCount: number;
	entitiesDetected: number;
	entitiesRedacted: number;
	categories: string[];
}

export async function logRedactionUsage(entry: RedactionLogEntry) {
	try {
		const client = generateClient({ authMode: "userPool" });
		await client.graphql({
			query: redactionCreateLog,
			variables: {
				input: {
					id: uuid(),
					mode: entry.mode,
					wordCount: entry.wordCount,
					entitiesDetected: entry.entitiesDetected,
					entitiesRedacted: entry.entitiesRedacted,
					categories: JSON.stringify(entry.categories),
				},
			},
		});
	} catch (error) {
		// Don't block the user if logging fails
		console.error("Failed to log redaction usage:", error);
	}
}
