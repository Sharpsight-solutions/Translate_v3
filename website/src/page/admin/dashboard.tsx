// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import "@cloudscape-design/global-styles/index.css";

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
	Box,
	Button,
	Cards,
	ColumnLayout,
	Container,
	ExpandableSection,
	Grid,
	Header,
	Pagination,
	Select,
	SpaceBetween,
	Spinner,
	Table,
	Textarea,
} from "@cloudscape-design/components";

import { generateClient } from "@aws-amplify/api";
import { fetchAuthSession } from "aws-amplify/auth";
import {
	CognitoIdentityProviderClient,
	ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
	BedrockRuntimeClient,
	InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const cfnOutputs = require("../../cfnOutputs.json");

// Cost model constants
const AFC_MIN_CHARGE = 45;
const AFC_MIN_WORDS = 300;
const AFC_RATE_PER_WORD = 0.15;
const AWS_TRANSLATE_COST_PER_MILLION_CHARS = 15;
const AVG_CHARS_PER_WORD = 5;

interface Job {
	id: string;
	jobOwner: string;
	jobName: string;
	createdAt: number;
	languageSource: string;
	languageTargets: string;
	wordCount: number | null;
	jobStatus: string;
	jobError: string | null;
	costCategory: string | null;
}

interface RedactionLog {
	id: string;
	userSub: string;
	mode: string;
	wordCount: number | null;
	entitiesDetected: number | null;
	entitiesRedacted: number | null;
	categories: string | null;
	createdAt: number;
}

interface FeedbackItem {
	id: string;
	userSub: string;
	feature: string;
	rating: string;
	jobId: string;
	createdAt: number;
}

type DateRange = "this_month" | "last_month" | "this_quarter" | "all_time";

const dateRangeOptions = [
	{ label: "This Month", value: "this_month" },
	{ label: "Last Month", value: "last_month" },
	{ label: "This Quarter", value: "this_quarter" },
	{ label: "All Time", value: "all_time" },
];

function calcThirdPartyCost(wordCount: number | null): number | null {
	if (!wordCount) return null;
	if (wordCount <= AFC_MIN_WORDS) return AFC_MIN_CHARGE;
	return AFC_MIN_CHARGE + (wordCount - AFC_MIN_WORDS) * AFC_RATE_PER_WORD;
}

function calcAwsCost(wordCount: number | null): number | null {
	if (!wordCount) return null;
	const chars = wordCount * AVG_CHARS_PER_WORD;
	return (chars / 1_000_000) * AWS_TRANSLATE_COST_PER_MILLION_CHARS;
}

function getDateRangeFilter(range: DateRange): (timestamp: number) => boolean {
	const now = new Date();
	switch (range) {
		case "this_month": {
			const start = new Date(now.getFullYear(), now.getMonth(), 1);
			return (ts) => ts >= start.getTime() / 1000;
		}
		case "last_month": {
			const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
			const end = new Date(now.getFullYear(), now.getMonth(), 1);
			return (ts) => ts >= start.getTime() / 1000 && ts < end.getTime() / 1000;
		}
		case "this_quarter": {
			const quarter = Math.floor(now.getMonth() / 3);
			const start = new Date(now.getFullYear(), quarter * 3, 1);
			return (ts) => ts >= start.getTime() / 1000;
		}
		case "all_time":
		default:
			return () => true;
	}
}

function formatCurrency(amount: number | null, currency = "£"): string {
	if (amount === null) return "—";
	return `${currency}${amount.toFixed(2)}`;
}

function formatDate(timestamp: number): string {
	return new Date(timestamp * 1000).toLocaleDateString("en-GB", {
		day: "2-digit",
		month: "short",
		year: "numeric",
	});
}

function parseLanguageTargets(targets: string | null): string {
	if (!targets) return "—";
	try {
		const parsed = JSON.parse(targets);
		if (Array.isArray(parsed)) return parsed.join(", ");
		return targets;
	} catch {
		return targets;
	}
}

export default function AdminDashboard() {
	const navigate = useNavigate();
	const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
	const [jobs, setJobs] = useState<Job[]>([]);
	const [redactionLogs, setRedactionLogs] = useState<RedactionLog[]>([]);
	const [feedbackItems, setFeedbackItems] = useState<FeedbackItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [dateRange, setDateRange] = useState<DateRange>("all_time");
	const [currentPage, setCurrentPage] = useState(1);
	const [userMap, setUserMap] = useState<Record<string, string>>({});
	const [insights, setInsights] = useState("");
	const [insightsLoading, setInsightsLoading] = useState(false);
	const [customQuery, setCustomQuery] = useState("");
	const [chatMessages, setChatMessages] = useState<Array<{role: "user" | "ai", content: string}>>([]);
	const pageSize = 20;

	// Check admin access
	useEffect(() => {
		const checkAdmin = async () => {
			try {
				const session = await fetchAuthSession();
				const idToken = session.tokens?.idToken;
				const groups: string[] =
					(idToken?.payload?.["cognito:groups"] as string[]) || [];
				if (!groups.includes("admin")) {
					setIsAdmin(false);
					navigate("/");
					return;
				}
				setIsAdmin(true);
			} catch (error) {
				console.error("Error checking admin status:", error);
				setIsAdmin(false);
				navigate("/");
			}
		};
		checkAdmin();
	}, [navigate]);

	// Fetch all jobs
	useEffect(() => {
		if (!isAdmin) return;

		const fetchJobs = async () => {
			setLoading(true);
			try {
				const client = generateClient({ authMode: "userPool" });
				const response: any = await client.graphql({
					query: `query TranslationListAllJobs {
						translationListAllJobs {
							items {
								id
								jobOwner
								jobName
								createdAt
								languageSource
								languageTargets
								wordCount
								jobStatus
								jobError
								costCategory
								teamName
								operationalArea
							}
							nextToken
						}
					}`,
				});
				const items = response.data.translationListAllJobs.items || [];
				setJobs(items);

				// Fetch redaction logs
				const redactionResponse: any = await client.graphql({
					query: `query RedactionListLogs {
						redactionListLogs {
							items {
								id
								userSub
								mode
								wordCount
								entitiesDetected
								entitiesRedacted
								categories
								createdAt
							}
							nextToken
						}
					}`,
				});
				const redactionItems = redactionResponse.data.redactionListLogs.items || [];
				setRedactionLogs(redactionItems);

				// Fetch feedback
				try {
					const feedbackResponse: any = await client.graphql({
						query: `query FeedbackList {
							feedbackList {
								items {
									id
									userSub
									feature
									rating
									jobId
									createdAt
								}
								nextToken
							}
						}`,
					});
					setFeedbackItems(feedbackResponse.data.feedbackList.items || []);
				} catch (err) {
					console.error("Could not fetch feedback:", err);
				}

				// Fetch user emails from Cognito
				try {
					const session = await fetchAuthSession();
					const credentials = session.credentials;
					if (credentials) {
						const cognitoClient = new CognitoIdentityProviderClient({
							region: cfnOutputs.awsRegion,
							credentials: {
								accessKeyId: credentials.accessKeyId,
								secretAccessKey: credentials.secretAccessKey,
								sessionToken: credentials.sessionToken,
							},
						});
						const usersResponse = await cognitoClient.send(
							new ListUsersCommand({
								UserPoolId: cfnOutputs.awsUserPoolsId,
								Limit: 60,
							})
						);
						const map: Record<string, string> = {};
						for (const user of usersResponse.Users || []) {
							const sub = user.Attributes?.find((a) => a.Name === "sub")?.Value;
							const email = user.Attributes?.find((a) => a.Name === "email")?.Value;
							if (sub && email) {
								map[sub] = email;
							}
						}
						setUserMap(map);
					}
				} catch (err) {
					console.error("Could not fetch user list:", err);
				}
			} catch (error) {
				console.error("Error fetching admin jobs:", error);
			} finally {
				setLoading(false);
			}
		};
		fetchJobs();
	}, [isAdmin]);

	// Generate AI insights
	const generateInsights = async (query?: string) => {
		const userMessage = query || "Provide 3-5 brief, actionable insights about this service's usage.";
		setChatMessages((prev) => [...prev, { role: "user", content: userMessage }]);
		setInsightsLoading(true);
		try {
			const session = await fetchAuthSession();
			const credentials = session.credentials;
			if (!credentials) return;

			const client = new BedrockRuntimeClient({
				region: cfnOutputs.awsRegion,
				credentials: {
					accessKeyId: credentials.accessKeyId,
					secretAccessKey: credentials.secretAccessKey,
					sessionToken: credentials.sessionToken,
				},
			});

			// Build a data summary for the AI
			const dataSummary = {
				totalTranslationJobs: jobs.length,
				totalRedactionJobs: redactionLogs.length,
				translationStats: {
					totalWords: jobs.reduce((s, j) => s + (j.wordCount || 0), 0),
					languages: [...new Set(jobs.flatMap((j) => {
						try { return JSON.parse(j.languageTargets || "[]"); } catch { return []; }
					}))],
					statuses: jobs.reduce((acc, j) => {
						acc[j.jobStatus || "unknown"] = (acc[j.jobStatus || "unknown"] || 0) + 1;
						return acc;
					}, {} as Record<string, number>),
					costCategories: jobs.reduce((acc, j) => {
						const cat = j.costCategory || "not_recorded";
						acc[cat] = (acc[cat] || 0) + 1;
						return acc;
					}, {} as Record<string, number>),
					topUsers: Object.entries(
						jobs.reduce((acc, j) => {
							const email = userMap[j.jobOwner] || j.jobOwner;
							acc[email] = (acc[email] || 0) + 1;
							return acc;
						}, {} as Record<string, number>)
					).sort((a, b) => b[1] - a[1]).slice(0, 5),
				},
				redactionStats: {
					totalWords: redactionLogs.reduce((s, l) => s + (l.wordCount || 0), 0),
					totalEntities: redactionLogs.reduce((s, l) => s + (l.entitiesRedacted || 0), 0),
					byMode: redactionLogs.reduce((acc, l) => {
						acc[l.mode] = (acc[l.mode] || 0) + 1;
						return acc;
					}, {} as Record<string, number>),
				},
				feedbackStats: {
					total: feedbackItems.length,
					positive: feedbackItems.filter((f) => f.rating === "positive").length,
					negative: feedbackItems.filter((f) => f.rating === "negative").length,
				},
				dateRange: dateRange,
			};

			const defaultPrompt = "Provide 3-5 brief, actionable insights for the service administrator. Focus on: adoption trends, which teams/users are getting the most value, any concerns (failed jobs, low usage), and suggestions to increase uptake. Keep it concise and practical — no jargon.";
			const userPrompt = query || defaultPrompt;

			const body = JSON.stringify({
				anthropic_version: "bedrock-2023-05-31",
				max_tokens: 800,
				messages: [
					{
						role: "user",
						content: `Here is the usage data for our Document Translation and Redaction service at Achieving for Children:\n\n${JSON.stringify(dataSummary, null, 2)}\n\n${userPrompt}`,
					},
				],
				system: "You are a helpful analytics assistant for Achieving for Children. Keep answers SHORT and to the point — max 3-4 bullet points or a brief paragraph. No lengthy explanations. Use bold for key numbers. Be direct and actionable.",
			});

			const response = await client.send(
				new InvokeModelCommand({
					modelId: "anthropic.claude-3-7-sonnet-20250219-v1:0",
					contentType: "application/json",
					accept: "application/json",
					body: new TextEncoder().encode(body),
				})
			);

			const responseBody = JSON.parse(new TextDecoder().decode(response.body));
			setChatMessages((prev) => [...prev, { role: "ai", content: responseBody.content[0].text }]);
		} catch (err: any) {
			setChatMessages((prev) => [...prev, { role: "ai", content: `Error: ${err.message}` }]);
		} finally {
			setInsightsLoading(false);
		}
	};

	if (isAdmin === null) {
		return <Spinner size="large" />;
	}

	const resolveUser = (sub: string) => userMap[sub] || sub;

	if (!isAdmin) {
		return null;
	}

	// Filter jobs by date range — stats only count completed jobs
	const dateFilter = getDateRangeFilter(dateRange);
	const filteredJobs = jobs.filter((job) => dateFilter(job.createdAt));
	const completedJobs = filteredJobs.filter(
		(job) =>
			job.jobStatus === "COMPLETED" || job.jobStatus === "DIRECT_COMPLETED"
	);

	// Calculate summary metrics (completed jobs only)
	const totalJobs = completedJobs.length;
	const totalWords = completedJobs.reduce(
		(sum, job) => sum + (job.wordCount || 0),
		0
	);
	const totalThirdPartyCost = completedJobs.reduce(
		(sum, job) => sum + (calcThirdPartyCost(job.wordCount) || 0),
		0
	);
	const totalAwsCost = completedJobs.reduce(
		(sum, job) => sum + (calcAwsCost(job.wordCount) || 0),
		0
	);
	const netSaving = totalThirdPartyCost - totalAwsCost;

	// Redaction stats
	const filteredRedactionLogs = redactionLogs.filter((log) =>
		dateFilter(log.createdAt)
	);
	const totalRedactions = filteredRedactionLogs.length;
	const redactionsByMode = {
		quick: filteredRedactionLogs.filter((l) => l.mode === "quick").length,
		ai: filteredRedactionLogs.filter((l) => l.mode === "ai").length,
		document: filteredRedactionLogs.filter((l) => l.mode === "document").length,
	};
	const totalRedactionWords = filteredRedactionLogs.reduce(
		(sum, log) => sum + (log.wordCount || 0),
		0
	);
	const totalEntitiesRedacted = filteredRedactionLogs.reduce(
		(sum, log) => sum + (log.entitiesRedacted || 0),
		0
	);

	// Pagination
	const totalPages = Math.ceil(filteredJobs.length / pageSize);
	const paginatedJobs = filteredJobs.slice(
		(currentPage - 1) * pageSize,
		currentPage * pageSize
	);

	return (
		<SpaceBetween size="l">
			<Header variant="h1">Admin Dashboard</Header>

			{/* Date Range Filter */}
			<Select
				selectedOption={
					dateRangeOptions.find((o) => o.value === dateRange) ||
					dateRangeOptions[3]
				}
				onChange={({ detail }) => {
					setDateRange(detail.selectedOption.value as DateRange);
					setCurrentPage(1);
				}}
				options={dateRangeOptions}
				placeholder="Select date range"
			/>

			{/* AI Insights — Chat interface */}
			<Container
				header={
					<Header
						variant="h2"
						actions={
							<Button
								onClick={() => generateInsights()}
								loading={insightsLoading}
								disabled={jobs.length === 0 && redactionLogs.length === 0}
								iconName="gen-ai"
							>
								Generate insights
							</Button>
						}
					>
						AI Insights
					</Header>
				}
			>
				<SpaceBetween size="m">
					{/* Chat messages */}
					<div
						style={{
							maxHeight: "350px",
							overflowY: "auto",
							display: "flex",
							flexDirection: "column",
							gap: "10px",
							padding: "4px 0",
						}}
					>
						{chatMessages.length === 0 && (
							<Box color="text-body-secondary" textAlign="center" padding={{ vertical: "m" }}>
								Ask a question or click "Generate insights" to get started.
							</Box>
						)}
						{chatMessages.map((msg, i) => (
							<div
								key={i}
								style={{
									display: "flex",
									justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
								}}
							>
								<div
									style={{
										maxWidth: "85%",
										padding: "10px 14px",
										borderRadius: msg.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
										backgroundColor: msg.role === "user" ? "#2E2E3A" : "#f0f2f5",
										color: msg.role === "user" ? "#ffffff" : "#1a1a2e",
										fontSize: "13px",
										lineHeight: "1.6",
									}}
									dangerouslySetInnerHTML={
										msg.role === "ai"
											? {
													__html: msg.content
														.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
														.replace(/^[\-\*] (.*?)$/gm, "• $1")
														.replace(/\n/g, "<br/>"),
												}
											: undefined
									}
								>
									{msg.role === "user" ? msg.content : undefined}
								</div>
							</div>
						))}
						{insightsLoading && (
							<div style={{ display: "flex", justifyContent: "flex-start" }}>
								<div
									style={{
										padding: "10px 14px",
										borderRadius: "14px 14px 14px 4px",
										backgroundColor: "#f0f2f5",
										fontSize: "13px",
										color: "#666",
									}}
								>
									Thinking...
								</div>
							</div>
						)}
					</div>

					{/* Input */}
					<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
						<input
							type="text"
							value={customQuery}
							onChange={(e) => setCustomQuery(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter" && customQuery.trim()) {
									generateInsights(customQuery.trim());
									setCustomQuery("");
								}
							}}
							placeholder="Ask about your data..."
							style={{
								flex: 1,
								padding: "10px 14px",
								border: "1px solid #d5dbdb",
								borderRadius: "20px",
								fontSize: "14px",
								outline: "none",
								minWidth: 0,
							}}
						/>
						<Button
							variant="primary"
							onClick={() => {
								if (customQuery.trim()) {
									generateInsights(customQuery.trim());
									setCustomQuery("");
								}
							}}
							disabled={!customQuery.trim() || insightsLoading}
							loading={insightsLoading}
						>
							Send
						</Button>
					</div>
				</SpaceBetween>
			</Container>

			{/* Dashboard Stats */}
			<Grid
				gridDefinition={[
					{ colspan: { default: 12, s: 6 } },
					{ colspan: { default: 12, s: 6 } },
				]}
			>
				<SpaceBetween size="m">
					{/* Translation Stats */}
					<Container header={<Header variant="h3">Translation</Header>}>
						<ColumnLayout columns={3} variant="text-grid">
							<div>
								<Box variant="awsui-key-label">Jobs</Box>
								<Box variant="h2">{totalJobs}</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Words translated</Box>
								<Box variant="h2">{totalWords.toLocaleString()}</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Net saving</Box>
								<Box variant="h2" color="text-status-success">
									{formatCurrency(netSaving)}
								</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Third-party equivalent</Box>
								<Box variant="p">{formatCurrency(totalThirdPartyCost)}</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">AWS cost</Box>
								<Box variant="p">{formatCurrency(totalAwsCost)}</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Saving rate</Box>
								<Box variant="p">
									{totalThirdPartyCost > 0
										? `${Math.round((netSaving / totalThirdPartyCost) * 100)}%`
										: "—"}
								</Box>
							</div>
						</ColumnLayout>
					</Container>

					{/* Cost Category Stats */}
					<Container header={<Header variant="h3">Cost Saving vs Unserviced Demand</Header>}>
						<ColumnLayout columns={3} variant="text-grid">
							<div>
								<Box variant="awsui-key-label">Cost saving</Box>
								<Box variant="h2" color="text-status-success">
									{completedJobs.filter((j) => j.costCategory === "saving").length}
								</Box>
								<Box variant="small" color="text-body-secondary">
									Would have paid for translation
								</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Unserviced demand</Box>
								<Box variant="h2" color="text-status-info">
									{completedJobs.filter((j) => j.costCategory === "unserviced_demand").length}
								</Box>
								<Box variant="small" color="text-body-secondary">
									Would have gone untranslated
								</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Not recorded</Box>
								<Box variant="h2">
									{completedJobs.filter((j) => !j.costCategory).length}
								</Box>
								<Box variant="small" color="text-body-secondary">
									Submitted before this question was added
								</Box>
							</div>
						</ColumnLayout>
					</Container>
				</SpaceBetween>

				<SpaceBetween size="m">
					{/* Redaction Stats */}
					<Container header={<Header variant="h3">Redaction</Header>}>
						<ColumnLayout columns={3} variant="text-grid">
							<div>
								<Box variant="awsui-key-label">Total jobs</Box>
								<Box variant="h2">{totalRedactions}</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Words processed</Box>
								<Box variant="h2">{totalRedactionWords.toLocaleString()}</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Entities redacted</Box>
								<Box variant="h2">{totalEntitiesRedacted.toLocaleString()}</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Quick Text</Box>
								<Box variant="p">{redactionsByMode.quick}</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">AI Redaction</Box>
								<Box variant="p">{redactionsByMode.ai}</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Document</Box>
								<Box variant="p">{redactionsByMode.document}</Box>
							</div>
						</ColumnLayout>
					</Container>

					{/* Feedback Stats */}
					<Container header={<Header variant="h3">User Feedback</Header>}>
						<ColumnLayout columns={3} variant="text-grid">
							<div>
								<Box variant="awsui-key-label">Total responses</Box>
								<Box variant="h2">{feedbackItems.length}</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Positive 👍</Box>
								<Box variant="h2" color="text-status-success">
									{feedbackItems.filter((f) => f.rating === "positive").length}
								</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Negative 👎</Box>
								<Box variant="h2" color="text-status-error">
									{feedbackItems.filter((f) => f.rating === "negative").length}
								</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Satisfaction rate</Box>
								<Box variant="p">
									{feedbackItems.length > 0
										? `${Math.round(
												(feedbackItems.filter((f) => f.rating === "positive").length /
													feedbackItems.length) *
													100
											)}%`
										: "—"}
								</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Translation</Box>
								<Box variant="p">
									👍 {feedbackItems.filter((f) => f.feature === "translation" && f.rating === "positive").length}{" "}
									👎 {feedbackItems.filter((f) => f.feature === "translation" && f.rating === "negative").length}
								</Box>
							</div>
							<div>
								<Box variant="awsui-key-label">Redaction</Box>
								<Box variant="p">
									👍 {feedbackItems.filter((f) => f.feature.startsWith("redaction") && f.rating === "positive").length}{" "}
									👎 {feedbackItems.filter((f) => f.feature.startsWith("redaction") && f.rating === "negative").length}
								</Box>
							</div>
						</ColumnLayout>
					</Container>
				</SpaceBetween>
			</Grid>

			{/* Translation Jobs Table */}
			<ExpandableSection
				headerText={`Translation Jobs (${filteredJobs.length})`}
				defaultExpanded={false}
			>
			<Table
				loading={loading}
				loadingText="Loading jobs..."
				items={paginatedJobs}
				empty={
					<Box textAlign="center" color="inherit">
						<b>No jobs found</b>
						<Box padding={{ bottom: "s" }} variant="p" color="inherit">
							No translation jobs match the selected date range.
						</Box>
					</Box>
				}
				columnDefinitions={[
					{
						id: "date",
						header: "Date",
						cell: (item) => formatDate(item.createdAt),
						sortingField: "createdAt",
					},
					{
						id: "user",
						header: "User",
						cell: (item) => resolveUser(item.jobOwner) || "—",
					},
					{
						id: "document",
						header: "Document",
						cell: (item) => item.jobName || "—",
					},
					{
						id: "source",
						header: "Source",
						cell: (item) => item.languageSource || "—",
					},
					{
						id: "targets",
						header: "Target(s)",
						cell: (item) => parseLanguageTargets(item.languageTargets),
					},
					{
						id: "wordCount",
						header: "Words",
						cell: (item) =>
							item.wordCount !== null && item.wordCount !== undefined
								? item.wordCount.toLocaleString()
								: "—",
					},
					{
						id: "thirdPartyCost",
						header: "3rd Party Cost",
						cell: (item) => formatCurrency(calcThirdPartyCost(item.wordCount)),
					},
					{
						id: "status",
						header: "Status",
						cell: (item) => {
							if (item.jobStatus === "FAILED" && item.jobError) {
								return (
									<Box color="text-status-error">
										{item.jobStatus}: {item.jobError}
									</Box>
								);
							}
							return item.jobStatus || "—";
						},
					},
				]}
				header={
					<Header counter={`(${filteredJobs.length})`}>
						Translation Jobs
					</Header>
				}
				pagination={
					<Pagination
						currentPageIndex={currentPage}
						pagesCount={totalPages || 1}
						onChange={({ detail }) =>
							setCurrentPage(detail.currentPageIndex)
						}
					/>
				}
				sortingDisabled={false}
			/>
			</ExpandableSection>

			{/* Redaction Log Table */}
			{filteredRedactionLogs.length > 0 && (
				<ExpandableSection
					headerText={`Redaction Log (${filteredRedactionLogs.length})`}
					defaultExpanded={false}
				>
				<Table
					items={filteredRedactionLogs.slice(0, 20)}
					columnDefinitions={[
						{
							id: "date",
							header: "Date",
							cell: (item) => formatDate(item.createdAt),
						},
						{
							id: "user",
							header: "User",
							cell: (item) => resolveUser(item.userSub) || "—",
						},
						{
							id: "mode",
							header: "Mode",
							cell: (item) => {
								switch (item.mode) {
									case "quick":
										return "Quick Text";
									case "ai":
										return "AI Quick Text";
									case "document":
										return "Document";
									default:
										return item.mode;
								}
							},
						},
						{
							id: "wordCount",
							header: "Words",
							cell: (item) =>
								item.wordCount ? item.wordCount.toLocaleString() : "—",
						},
						{
							id: "entities",
							header: "Entities Redacted",
							cell: (item) =>
								item.entitiesRedacted
									? item.entitiesRedacted.toLocaleString()
									: "—",
						},
						{
							id: "categories",
							header: "Categories",
							cell: (item) => {
								if (!item.categories) return "—";
								try {
									const cats = JSON.parse(item.categories);
									return Array.isArray(cats) ? cats.join(", ") : item.categories;
								} catch {
									return item.categories;
								}
							},
						},
					]}
					header={
						<Header counter={`(${filteredRedactionLogs.length})`}>
							Redaction Log
						</Header>
					}
				/>
				</ExpandableSection>
			)}
		</SpaceBetween>
	);
}
