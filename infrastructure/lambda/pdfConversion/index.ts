// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {
	S3Client,
	GetObjectCommand,
	PutObjectCommand,
	DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import {
	TextractClient,
	DetectDocumentTextCommand,
} from "@aws-sdk/client-textract";
import {
	DynamoDBClient,
	UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import pdf from "pdf-parse";

const s3 = new S3Client({});
const textract = new TextractClient({});
const dynamodb = new DynamoDBClient({});

const MAX_SIZE = parseInt(process.env.PDF_MAX_SIZE_BYTES || "4194304");
const JOB_TABLE_NAME = process.env.JOB_TABLE_NAME || "";

async function updateJobFailed(jobId: string, message: string) {
	await dynamodb.send(
		new UpdateItemCommand({
			TableName: JOB_TABLE_NAME,
			Key: { id: { S: jobId } },
			UpdateExpression: "SET jobStatus = :s, jobError = :e",
			ExpressionAttributeValues: {
				":s": { S: "FAILED" },
				":e": { S: message },
			},
		})
	);
}

export const handler = async (event: any) => {
	const record = event.Records[0];
	const bucket = record.s3.bucket.name;
	const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
	const sizeBytes = record.s3.object.size;

	// Parse job ID from S3 key: private/{identityId}/{jobId}/upload/{filename}
	const keyParts = key.split("/");
	const jobId = keyParts[2];

	try {
		// Validate file size
		if (sizeBytes > MAX_SIZE) {
			await updateJobFailed(
				jobId,
				`PDF exceeds maximum size of 4MB (uploaded: ${(sizeBytes / 1024 / 1024).toFixed(1)}MB)`
			);
			return;
		}

		// Retrieve PDF from S3
		const s3Response = await s3.send(
			new GetObjectCommand({ Bucket: bucket, Key: key })
		);
		const bodyBytes = await s3Response.Body?.transformToByteArray();

		if (!bodyBytes) {
			await updateJobFailed(jobId, "Failed to read PDF file from storage.");
			return;
		}

		let extractedText = "";

		// Strategy 1: Try direct PDF text extraction (for born-digital PDFs)
		try {
			const pdfBuffer = Buffer.from(bodyBytes);
			const pdfData = await pdf(pdfBuffer);
			extractedText = pdfData.text?.trim() || "";
			if (extractedText) {
				console.log(`PDF text extracted directly: ${extractedText.length} chars`);
			}
		} catch (pdfErr) {
			console.log("Direct PDF extraction failed, falling back to Textract:", pdfErr);
		}

		// Strategy 2: Fall back to Textract (for scanned/image-based PDFs)
		if (!extractedText) {
			try {
				const textractResult = await textract.send(
					new DetectDocumentTextCommand({
						Document: { Bytes: bodyBytes },
					})
				);
				extractedText = (textractResult.Blocks || [])
					.filter((block) => block.BlockType === "LINE")
					.map((block) => block.Text)
					.join("\n");
				if (extractedText) {
					console.log(`PDF text extracted via Textract: ${extractedText.length} chars`);
				}
			} catch (textractErr: any) {
				console.log("Textract extraction also failed:", textractErr.message);
			}
		}

		// If neither method produced text, fail the job
		if (!extractedText.trim()) {
			await updateJobFailed(
				jobId,
				"Could not extract any text from the PDF. The document may be blank, encrypted, or in an unsupported format."
			);
			return;
		}

		// Write extracted text back to S3
		const txtKey = key.replace(/\.pdf$/i, ".txt");
		await s3.send(
			new PutObjectCommand({
				Bucket: bucket,
				Key: txtKey,
				Body: extractedText,
				ContentType: "text/plain",
			})
		);

		// Remove original PDF
		await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));

		// Update job contentType in DynamoDB
		await dynamodb.send(
			new UpdateItemCommand({
				TableName: JOB_TABLE_NAME,
				Key: { id: { S: jobId } },
				UpdateExpression: "SET contentType = :ct",
				ExpressionAttributeValues: { ":ct": { S: "text/plain" } },
			})
		);
	} catch (err) {
		console.error("PDF conversion failed:", err);
		await updateJobFailed(
			jobId,
			"PDF conversion encountered an unexpected error. Please try again or contact support."
		);
	}
};
