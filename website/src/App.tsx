// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useEffect, useState } from "react";
import { Suspense } from "react";

import { AppLayout } from "@cloudscape-design/components";

import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";

import "./util/i18n";

import AppRoutes from "./appRoutes";
import SideNavigation from "./page/partial/sideNavigation";
import TopNavigation from "./page/partial/topNavigation";
import WelcomeScreen from "./page/welcome/welcomeScreen";
import { ToastProvider } from "./util/useToast";

export default function App() {
	const [authState, setAuthState] = useState<
		"loading" | "authenticated" | "unauthenticated"
	>("loading");
	const [currentUser, setCurrentUser] = useState<any>(undefined);

	const checkAuth = async () => {
		try {
			const session = await fetchAuthSession();
			if (session.credentials) {
				const user = await getCurrentUser();
				setCurrentUser({ currentUser: user, authSession: session });
				setAuthState("authenticated");
			} else {
				setAuthState("unauthenticated");
			}
		} catch {
			setAuthState("unauthenticated");
		}
	};

	useEffect(() => {
		checkAuth();
	}, []);

	// Loading state
	if (authState === "loading") {
		return (
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					minHeight: "100vh",
					backgroundColor: "#f9f9fb",
					gap: "16px",
				}}
			>
				<img
					src="https://www.achievingforchildren.org.uk/images/afccorporate/corporate_logo.svg"
					alt="Achieving for Children"
					style={{ width: "180px", height: "auto" }}
				/>
				<div
					style={{
						width: "40px",
						height: "40px",
						border: "3px solid #e0e0e8",
						borderTopColor: "#4a4a6a",
						borderRadius: "50%",
						animation: "spin 0.8s linear infinite",
					}}
				/>
				<style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
			</div>
		);
	}

	// Unauthenticated - show welcome screen
	if (authState === "unauthenticated") {
		return (
			<WelcomeScreen
				onSignedIn={() => {
					checkAuth();
				}}
			/>
		);
	}

	// Authenticated - show app
	return (
		<ToastProvider>
			<Suspense fallback={null}>
				<TopNavigation user={currentUser} />
				<AppLayout
					navigation={<SideNavigation />}
					toolsHide
					content={<AppRoutes />}
				></AppLayout>
			</Suspense>
		</ToastProvider>
	);
}
