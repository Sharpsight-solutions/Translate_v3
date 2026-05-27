// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { useEffect, useRef, useState } from "react";

import { generateClient } from "@aws-amplify/api";

const features = require("../../../features.json");
let listJobs: string;
if (features.translation) {
	listJobs = require("../../../graphql/queries").translationListJobs;
}

const client = generateClient({ authMode: "userPool" });

// Request notification permission on first load
function requestNotificationPermission() {
	if ("Notification" in window && Notification.permission === "default") {
		Notification.requestPermission();
	}
}

function sendNotification(jobName: string) {
	if ("Notification" in window && Notification.permission === "granted") {
		const notification = new Notification("Translation ready", {
			body: `Your translation of "${jobName}" is complete and ready to download.`,
			icon: "https://www.achievingforchildren.org.uk/images/afccorporate/corporate_logo.svg",
			tag: "translation-complete",
		});
		notification.onclick = () => {
			window.focus();
			notification.close();
		};
	}
}

export const useTranslationJobs = () => {
	const [jobs, updateJobs] = useState([]);
	const [loading, setLoading] = useState<Boolean>(true);
	const previousStatusesRef = useRef<Record<string, string>>({});

	const fetchJobs = async () => {
		try {
			const response = await client.graphql({
				query: listJobs,
			});
			let data: any;
			if ("data" in response) {
				data = response.data.translationListJobs.items;
			}

			// Check for newly completed jobs
			if (data && Object.keys(previousStatusesRef.current).length > 0) {
				for (const job of data) {
					const prevStatus = previousStatusesRef.current[job.id];
					const currentStatus = job.jobStatus?.toUpperCase();
					if (
						prevStatus &&
						prevStatus !== "COMPLETED" &&
						prevStatus !== "DIRECT_COMPLETED" &&
						(currentStatus === "COMPLETED" || currentStatus === "DIRECT_COMPLETED")
					) {
						sendNotification(job.jobName || "your document");
					}
				}
			}

			// Store current statuses for next comparison
			if (data) {
				const statuses: Record<string, string> = {};
				for (const job of data) {
					statuses[job.id] = job.jobStatus?.toUpperCase() || "";
				}
				previousStatusesRef.current = statuses;
			}

			updateJobs(data);
		} catch (error) {}
		setLoading(false);
	};

	useEffect(() => {
		requestNotificationPermission();
		fetchJobs();

		// Poll every 15 seconds to detect job completion
		const interval = setInterval(fetchJobs, 15000);
		return () => clearInterval(interval);
	}, []);

	return { jobs, loading };
};
