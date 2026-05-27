// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

const s3 = new S3Client({});
const dynamodb = new DynamoDBClient({});

const JOB_TABLE_NAME = process.env.JOB_TABLE_NAME || "";

function countWords(text: string): number {
	return text
		.trim()
		.split(/\s+/)
		.filter((word) => word.length > 0).length;
}

export const handler = async (event: any) => {
	try {
		const record = event.Records[0];
		const bucket = record.s3.bucket.name;
		const key = decodeURIComponent(
			record.s3.object.key.replace(/\+/g, " ")
		);

		// Parse job ID from S3 key: private/{identityId}/{jobId}/upload/{filename}
		const keyParts = key.split("/");
		const jobId = keyParts[2];

		// Get file extension
		const extension = key.split(".").pop()?.toLowerCase();

		// Retrieve file from S3
		const s3Response = await s3.send(
			new GetObjectCommand({ Bucket: bucket, Key: key })
		);

		let wordCount = 0;

		switch (extension) {
			case "txt":
			case "html": {
				const text = await s3Response.Body?.transformToString("utf-8");
				if (text) {
					// Strip HTML tags for .html files
					const plainText =
						extension === "html"
							? text.replace(/<[^>]*>/g, " ")
							: text;
					wordCount = countWords(plainText);
				}
				break;
			}
			case "docx": {
				const bodyBytes = await s3Response.Body?.transformToByteArray();
				if (bodyBytes) {
					const result = await mammoth.extractRawText({
						buffer: Buffer.from(bodyBytes),
					});
					wordCount = countWords(result.value);
				}
				break;
			}
			case "xlsx": {
				const bodyBytes = await s3Response.Body?.transformToByteArray();
				if (bodyBytes) {
					const workbook = XLSX.read(Buffer.from(bodyBytes), {
						type: "buffer",
					});
					let allText = "";
					for (const sheetName of workbook.SheetNames) {
						const sheet = workbook.Sheets[sheetName];
						const csv = XLSX.utils.sheet_to_csv(sheet);
						allText += csv + " ";
					}
					wordCount = countWords(allText);
				}
				break;
			}
			default:
				console.log(`Unsupported file extension for word count: ${extension}`);
				return;
		}

		// Write wordCount to DynamoDB
		await dynamodb.send(
			new UpdateItemCommand({
				TableName: JOB_TABLE_NAME,
				Key: { id: { S: jobId } },
				UpdateExpression: "SET wordCount = :wc",
				ExpressionAttributeValues: { ":wc": { N: String(wordCount) } },
			})
		);

		console.log(`Word count for job ${jobId}: ${wordCount}`);
	} catch (err) {
		// Do not throw — allow the pipeline to continue even if word count fails
		console.error("Word count extraction failed:", err);
	}
};
