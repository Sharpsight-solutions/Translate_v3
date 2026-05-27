// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { SideNavigation } from "@cloudscape-design/components";

import { fetchAuthSession } from "@aws-amplify/auth";

import { CreateJob as ReadableCreateJob } from "../../util/readableCreateJob";

const features = require("../../features.json");

export default function Navigation() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [isAdmin, setIsAdmin] = useState(false);

	useEffect(() => {
		const checkAdmin = async () => {
			try {
				const session = await fetchAuthSession();
				const idToken = session.tokens?.idToken;
				const groups: string[] =
					(idToken?.payload?.["cognito:groups"] as string[]) || [];
				setIsAdmin(groups.includes("admin"));
			} catch {
				setIsAdmin(false);
			}
		};
		checkAdmin();
	}, []);

	const navigationItems = [];
	if (features.translation) {
		navigationItems.push({
			type: "section-group",
			title: t("translation_title"),
			items: [
				{
					type: "link",
					text: t("generic_history"),
					href: "/translation/history",
				},
				{
					type: "link",
					text: t("generic_create_new"),
					href: "/translation/new",
				},
				{
					type: "link",
					text: t("translation_quick_text"),
					href: "/translation/quick",
				},
			],
		});
	}
	if (features.translation && features.readable) {
		navigationItems.push({ type: "divider" });
	}
	if (features.readable) {
		navigationItems.push({
			type: "section-group",
			title: t("readable_title"),
			items: [
				{
					type: "link",
					text: t("generic_history"),
					href: "/readable/history",
				},
				{
					type: "link",
					text: t("generic_create_new"),
					href: "/readable/view",
				},
			],
		});
	}

	// Tools section - available to all users
	navigationItems.push({ type: "divider" });
	navigationItems.push({
		type: "section-group",
		title: "Redaction",
		items: [
			{
				type: "link",
				text: "Quick Text",
				href: "/redaction",
			},
			{
				type: "link",
				text: "Document",
				href: "/redaction/document",
			},
			{
				type: "link",
				text: "Review & Approve",
				href: "/redaction/review",
			},
		],
	});
	navigationItems.push({ type: "divider" });
	navigationItems.push({
		type: "section-group",
		title: "Tools",
		items: [
			{
				type: "link",
				text: "Readability checker",
				href: "/readability",
			},
		],
	});

	if (isAdmin) {
		navigationItems.push({ type: "divider" });
		navigationItems.push({
			type: "section-group",
			title: "Admin",
			items: [
				{
					type: "link",
					text: "Dashboard",
					href: "/admin",
				},
			],
		});
	}

	// Support section — always at the bottom
	navigationItems.push({ type: "divider" });
	navigationItems.push({
		type: "section-group",
		title: "Support",
		items: [
			{
				type: "link",
				text: "Help & user guide",
				href: "/help",
			},
			{
				type: "link",
				text: "How it works",
				href: "/transparency",
			},
		],
	});

	return (
		<SideNavigation
			data-testid="sidenavigation"
			activeHref={window.location.pathname}
			onFollow={async (event) => {
				if (!event.detail.external) {
					event.preventDefault();

					const readableViewHref = "/readable/view";
					const href = event.detail.href;
					if (href.startsWith(readableViewHref)) {
						const jobId = await ReadableCreateJob();
						const jobHref = `${readableViewHref}?jobId=${jobId}`;

						if (window.location.pathname.startsWith(readableViewHref)) {
							window.location.href = jobHref;
							return;
						} else {
							navigate(jobHref);
							return;
						}
					}
					navigate(href);
				}
			}}
			items={navigationItems}
		/>
	);
}
