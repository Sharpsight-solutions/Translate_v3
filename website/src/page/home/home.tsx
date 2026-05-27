// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import "@cloudscape-design/global-styles/index.css";

import React from "react";
import { useNavigate } from "react-router-dom";

import {
	Box,
	Button,
	ColumnLayout,
	Container,
	Header,
	Link,
	SpaceBetween,
} from "@cloudscape-design/components";

export default function Home() {
	const navigate = useNavigate();

	return (
		<SpaceBetween size="l">
			{/* Welcome header */}
			<Container>
				<SpaceBetween size="s">
					<Box variant="h1" fontSize="display-l">
						Welcome to the Document Transformation Service
					</Box>
					<Box variant="p" fontSize="heading-m" color="text-body-secondary">
						Helping AfC staff communicate clearly with residents and families
						across our communities.
					</Box>
					<Box variant="p">
						This service lets you translate documents into other languages,
						remove personal information before sharing, and check how easy your
						writing is to understand — all securely within AfC's own
						environment. Your documents are never shared externally.
					</Box>
				</SpaceBetween>
			</Container>

			{/* What would you like to do? */}
			<Header variant="h2">What would you like to do?</Header>

			<ColumnLayout columns={3}>
				{/* Translate */}
				<Container
					header={
						<Header variant="h3">
							<span style={{ marginRight: "8px" }}>🌍</span>
							Translate
						</Header>
					}
				>
					<SpaceBetween size="m">
						<Box variant="p">
							Upload a document and translate it into one or more languages.
							Supports Word, HTML, and spreadsheet formats.
						</Box>
						<SpaceBetween size="xs">
							<Link
								href="/translation/new"
								onFollow={(e) => {
									e.preventDefault();
									navigate("/translation/new");
								}}
							>
								Translate a document
							</Link>
							<Link
								href="/translation/quick"
								onFollow={(e) => {
									e.preventDefault();
									navigate("/translation/quick");
								}}
							>
								Quick text translate
							</Link>
							<Link
								href="/translation/history"
								onFollow={(e) => {
									e.preventDefault();
									navigate("/translation/history");
								}}
							>
								View translation history
							</Link>
						</SpaceBetween>
					</SpaceBetween>
				</Container>

				{/* Redact */}
				<Container
					header={
						<Header variant="h3">
							<span style={{ marginRight: "8px" }}>🔒</span>
							Redact
						</Header>
					}
				>
					<SpaceBetween size="m">
						<Box variant="p">
							Remove personal information from documents using AI. Review
							suggestions before they're applied so you stay in control.
						</Box>
						<SpaceBetween size="xs">
							<Link
								href="/redaction/review"
								onFollow={(e) => {
									e.preventDefault();
									navigate("/redaction/review");
								}}
							>
								Review &amp; Approve (recommended)
							</Link>
							<Link
								href="/redaction"
								onFollow={(e) => {
									e.preventDefault();
									navigate("/redaction");
								}}
							>
								Quick Text
							</Link>
							<Link
								href="/redaction/document"
								onFollow={(e) => {
									e.preventDefault();
									navigate("/redaction/document");
								}}
							>
								Document redaction
							</Link>
						</SpaceBetween>
					</SpaceBetween>
				</Container>

				{/* Tools */}
				<Container
					header={
						<Header variant="h3">
							<span style={{ marginRight: "8px" }}>📊</span>
							Tools
						</Header>
					}
				>
					<SpaceBetween size="m">
						<Box variant="p">
							Check how easy your writing is to understand before translating.
							Simpler English produces better translations and is more
							accessible to residents.
						</Box>
						<SpaceBetween size="xs">
							<Link
								href="/readability"
								onFollow={(e) => {
									e.preventDefault();
									navigate("/readability");
								}}
							>
								Readability checker
							</Link>
							<Link
								href="/help"
								onFollow={(e) => {
									e.preventDefault();
									navigate("/help");
								}}
							>
								Help &amp; user guide
							</Link>
						</SpaceBetween>
					</SpaceBetween>
				</Container>
			</ColumnLayout>

			{/* Getting started tips */}
			<Container
				header={
					<Header variant="h2">New here? Here's how to get started</Header>
				}
			>
				<ColumnLayout columns={3} variant="text-grid">
					<div>
						<Box variant="awsui-key-label">Step 1</Box>
						<Box variant="p">
							Choose what you need — translate a document, redact personal
							information, or check readability.
						</Box>
					</div>
					<div>
						<Box variant="awsui-key-label">Step 2</Box>
						<Box variant="p">
							Upload your file or paste your text. The service handles Word,
							HTML, and spreadsheet formats.
						</Box>
					</div>
					<div>
						<Box variant="awsui-key-label">Step 3</Box>
						<Box variant="p">
							Your results will be ready within minutes. Translations appear in
							your History; redacted documents can be downloaded immediately.
						</Box>
					</div>
				</ColumnLayout>
			</Container>

			{/* PDF tip */}
			<Container
				header={
					<Header variant="h2">📄 Have a PDF? Convert it to Word first</Header>
				}
			>
				<SpaceBetween size="s">
					<Box variant="p">
						The translation service works best with Word documents (.docx). If
						you only have a PDF, you can convert it in a few seconds using Google
						Docs:
					</Box>
					<Box variant="ol">
						<li>
							Open <strong>Google Drive</strong> (drive.google.com)
						</li>
						<li>
							Upload your PDF file
						</li>
						<li>
							Right-click the file → <strong>Open with</strong> →{" "}
							<strong>Google Docs</strong>
						</li>
						<li>
							In Google Docs, go to <strong>File</strong> →{" "}
							<strong>Download</strong> → <strong>Microsoft Word (.docx)</strong>
						</li>
						<li>
							Upload the downloaded .docx file to this service
						</li>
					</Box>
					<Box variant="p" color="text-body-secondary">
						This preserves most formatting including headings, tables, and
						images. The translated Word document will look very similar to your
						original PDF.
					</Box>
				</SpaceBetween>
			</Container>

			{/* Data safety note */}
			<Box variant="small" color="text-body-secondary" textAlign="center">
				All documents are processed securely within Achieving for Children's
				own AWS environment. Nothing is shared with third parties. Documents
				are automatically deleted after 7 days.
			</Box>
		</SpaceBetween>
	);
}
