// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import "@cloudscape-design/global-styles/index.css";

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
	Box,
	Button,
	Container,
	Form,
	FormField,
	Header,
	Input,
	RadioGroup,
	SpaceBetween,
} from "@cloudscape-design/components";

import { generateClient } from "@aws-amplify/api";
import { fetchAuthSession } from "@aws-amplify/auth";

import { putObjectS3 } from "../../util/putObjectS3";
import { getBrowserLanguage } from "./util/getBrowserLanguage";
import { useToast } from "../../util/useToast";

import NewFormOriginalDocument from "./newFormOriginalDocument";
import NewFormOriginalLanguage from "./newFormOriginalLanguage";
import NewFormSavingJob from "./newFormSavingJob";
import NewFormTargetLanguages from "./newFormTargetLanguages";

import { v4 as uuid } from "uuid";

const features = require("../../features.json");

// Client-side word count for text-based files
async function getFileWordCount(file: File): Promise<number | null> {
	try {
		const text = await file.text();
		// Strip HTML tags if it's an HTML file
		const plainText = file.type === "text/html"
			? text.replace(/<[^>]*>/g, " ")
			: text;
		const words = plainText.trim().split(/\s+/).filter((w) => w.length > 0);
		return words.length;
	} catch {
		return null;
	}
}
let createJob: string;
if (features.translation) {
	createJob = require("../../graphql/mutations").translationCreateJob;
}

const initialFormState: {
	saving: boolean;
	uploadDocument: boolean;
	submitJobInfo: boolean;
} = {
	saving: false,
	uploadDocument: false,
	submitJobInfo: false,
};

const initialOriginalDocumentFormErrors: {
	noOriginalDoc: boolean;
	unsupportedFileType: boolean;
	unsupportedFileSize: boolean;
} = {
	noOriginalDoc: false,
	unsupportedFileType: false,
	unsupportedFileSize: false,
};

export default function NewForm() {
	const [originalDocumentFileState, updateOriginalDocumentFileState] = useState<
		File | undefined
	>();
	const [originalDocumentFormErrors, updateOriginalDocumentFormErrors] =
		useState(initialOriginalDocumentFormErrors);
	const [originalLanguageSource, updateOriginalLanguageSource] =
		useState<string>(getBrowserLanguage());
	const [targetLanguagesSelectionState, updateTargetLanguagesSelectionState] =
		useState<string[]>([]);
	const [formState, updateFormState] = useState(initialFormState);
	const [wouldHavePaid, setWouldHavePaid] = useState<string>("yes");
	const [teamName, setTeamName] = useState<string>("");
	const [operationalArea, setOperationalArea] = useState<string>("kingston_richmond");

	const navigate = useNavigate();
	const { showToast } = useToast();

	const isError = () => {
		if (
			originalDocumentFormErrors.noOriginalDoc ||
			originalDocumentFormErrors.unsupportedFileType ||
			originalDocumentFormErrors.unsupportedFileSize
		) {
			return true;
		}

		if (!originalDocumentFileState) return true;

		if (targetLanguagesSelectionState.length === 0) return true;
	};

	const uploadFile = async (file: File, jobId: string) => {
		let identityId;
		try {
			const authSession = await fetchAuthSession();
			identityId = authSession.identityId;
		} catch (error) {
			console.log("Error fetching identityId:", error);
		}
		try {
			await putObjectS3({
				bucketKey: "awsUserFilesS3Bucket",
				path: `private/${identityId}/${jobId}/upload/${file.name}`,
				file: file,
			});
		} catch (error) {
			console.log(error);
		}
	};

	// Handle translation — upload to S3 and submit job
	async function handleTraditionalTranslation() {
		if (isError()) return false;

		const jobId = uuid();

		// Count words client-side
		const wordCount = originalDocumentFileState
			? await getFileWordCount(originalDocumentFileState)
			: null;

		updateFormState((currentState) => ({
			...currentState,
			saving: true,
		}));

		if (originalDocumentFileState) {
			await uploadFile(originalDocumentFileState, jobId);
			updateFormState((currentState) => ({
				...currentState,
				uploadDocument: true,
			}));
		}

		const translateStatus: { [key: string]: string } = {};
		const translateKey: { [key: string]: string } = {};
		const translateCallback: { [key: string]: string } = {};
		targetLanguagesSelectionState.forEach((element: string) => {
			translateStatus["lang" + element] = "Submitted";
			translateKey["lang" + element] = "";
			translateCallback["lang" + element] = "";
		});

		const authSession = await fetchAuthSession();
		const jobInfo: {
			jobIdentity: string;
			id: string;
			jobName: string;
			languageSource: string;
			languageTargets: string;
			contentType: string;
			translateStatus: string;
			translateKey: string;
			translateCallback: string;
			jobStatus: string;
			wordCount: number | null;
			costCategory: string;
			teamName: string;
			operationalArea: string;
		} = {
			jobIdentity: authSession.identityId || "",
			id: jobId,
			jobName: originalDocumentFileState?.name || "",
			languageSource: originalLanguageSource,
			languageTargets: JSON.stringify([
				...new Set(targetLanguagesSelectionState),
			]),
			contentType: originalDocumentFileState?.type || "",
			translateStatus: JSON.stringify(translateStatus),
			translateKey: JSON.stringify(translateKey),
			translateCallback: JSON.stringify(translateCallback),
			jobStatus: "UPLOADED",
			wordCount: wordCount,
			costCategory: wouldHavePaid === "yes" ? "saving" : "unserviced_demand",
			teamName: teamName,
			operationalArea: operationalArea,
		};

		try {
			const client = generateClient({ authMode: "userPool" });
			await client.graphql({
				query: createJob,
				variables: { input: jobInfo },
			});
			updateFormState((currentState) => ({
				...currentState,
				submitJobInfo: true,
			}));
			showToast("Translation submitted — your document will be ready in History within about 15 minutes.");
			navigate("/translation/history");
		} catch (error) {
			console.log("Error uploading job info");
			throw error;
		}
	}

	// Main save function — always uses standard pipeline
	async function save() {
		if (isError()) return false;
		return handleTraditionalTranslation();
	}

	const { t } = useTranslation();

	return (
		<>
			{!formState.saving && (
				<form onSubmit={(e) => e.preventDefault()}>
					<SpaceBetween direction="vertical" size="xxl">
						<Form
							actions={
								<SpaceBetween direction="horizontal" size="xxl">
									<Button
										formAction="none"
										variant="link"
										onClick={(e) => navigate("/translation/history")}
									>
										{t("generic_cancel")}
									</Button>
									<Button
										variant="primary"
										onClick={save}
										disabled={isError()}
										data-testid="translation-new-submit"
									>
										{t("generic_submit")}
									</Button>
								</SpaceBetween>
							}
						>
							<SpaceBetween direction="vertical" size="xxl">
								<NewFormOriginalDocument
									fileState={originalDocumentFileState}
									updateFileState={updateOriginalDocumentFileState}
									formErrors={originalDocumentFormErrors}
									updateFormErrors={updateOriginalDocumentFormErrors}
								/>

								<NewFormOriginalLanguage
									languageSource={originalLanguageSource}
									updateLanguageSource={updateOriginalLanguageSource}
								/>
								<NewFormTargetLanguages
									selectionState={targetLanguagesSelectionState}
									updateSelectionState={updateTargetLanguagesSelectionState}
									originalLanguage={originalLanguageSource}
								/>

								<Container
									header={
										<Header variant="h2">
											Would you have previously paid for this translation?
										</Header>
									}
								>
									<FormField
										description="This helps us understand whether this service is saving money or meeting previously unserviced demand."
									>
										<RadioGroup
											value={wouldHavePaid}
											onChange={({ detail }) => setWouldHavePaid(detail.value)}
											items={[
												{ value: "yes", label: "Yes — we would have commissioned a third-party translation" },
												{ value: "no", label: "No — this would have gone untranslated" },
											]}
										/>
									</FormField>
								</Container>

								<Container
									header={
										<Header variant="h2">
											About you
										</Header>
									}
								>
									<SpaceBetween size="m">
										<FormField label="Team name">
											<Input
												value={teamName}
												onChange={({ detail }) => setTeamName(detail.value)}
												placeholder="e.g. Safeguarding, Fostering Team, Conference & Review Service"
											/>
										</FormField>
										<FormField label="Operational area">
											<RadioGroup
												value={operationalArea}
												onChange={({ detail }) => setOperationalArea(detail.value)}
												items={[
													{ value: "kingston_richmond", label: "Kingston and Richmond" },
													{ value: "windsor_maidenhead", label: "Windsor and Maidenhead" },
												]}
											/>
										</FormField>
									</SpaceBetween>
								</Container>
							</SpaceBetween>
						</Form>
					</SpaceBetween>
				</form>
			)}

			{formState.saving && (
				<NewFormSavingJob
					submitJobInfo={formState.submitJobInfo}
					uploadDocument={formState.uploadDocument}
				/>
			)}
		</>
	);
}
