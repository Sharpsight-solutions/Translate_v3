// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React from "react";
import { Route, Routes } from "react-router-dom";

import SignOut from "./util/signOut";

import AdminDashboard from "./page/admin/dashboard";
import Help from "./page/help/help";
import Home from "./page/home/home";
import ReadabilityChecker from "./page/readability/readability";
import RedactionIndex from "./page/redaction/redactionIndex";
import Transparency from "./page/transparency/transparency";
import ReadableHistory from "./page/readable/history";
import ReadablePrint from "./page/readable/print";
import ReadableView from "./page/readable/view";
import TranslationHistory from "./page/translation/history";
import TranslationNew from "./page/translation/new";
import TranslationQuick from "./page/translation/quick";

const features = require("./features.json");

export default function AppRoutes() {
	return (
		<Routes>
			{features.translation && (
				<>
					<Route path="/" element={<Home />} />
					<Route path="/translation/" element={<TranslationHistory />} />
					<Route
						path="/translation/history/"
						element={<TranslationHistory />}
					/>
					<Route path="/translation/new/" element={<TranslationNew />} />
					<Route path="/translation/quick/" element={<TranslationQuick />} />
				</>
			)}
			{!features.translation && features.readable && (
				<Route path="/" element={<ReadableHistory />} />
			)}
			{features.readable && (
				<>
					<Route path="/readable/" element={<ReadableHistory />} />
					<Route path="/readable/history/" element={<ReadableHistory />} />
					<Route path="/readable/view/*" element={<ReadableView />} />
					<Route path="/readable/print/*" element={<ReadablePrint />} />
				</>
			)}
			<Route path="/help/" element={<Help />} />
			<Route path="/transparency/" element={<Transparency />} />
			<Route path="/readability/" element={<ReadabilityChecker />} />
			<Route path="/redaction/*" element={<RedactionIndex />} />
			<Route path="/admin/" element={<AdminDashboard />} />
			<Route path="/signout/" element={<SignOut />} />
		</Routes>
	);
}
