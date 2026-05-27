// Shared utility for extracting text from uploaded files
import mammoth from "mammoth";

export async function extractTextFromFile(file: File): Promise<string> {
	const type = file.type;

	if (type === "text/plain") {
		return await file.text();
	}

	if (type === "text/html") {
		const html = await file.text();
		return html
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/p>/gi, "\n\n")
			.replace(/<\/div>/gi, "\n")
			.replace(/<\/li>/gi, "\n")
			.replace(/<[^>]*>/g, "")
			.replace(/&nbsp;/g, " ")
			.replace(/&amp;/g, "&")
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.trim();
	}

	if (
		type ===
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	) {
		const arrayBuffer = await file.arrayBuffer();
		const result = await mammoth.extractRawText({ arrayBuffer });
		return result.value;
	}

	return "";
}
