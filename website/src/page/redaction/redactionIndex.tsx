// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React from "react";
import { Route, Routes } from "react-router-dom";

import RedactionAi from "./redactionAi";
import RedactionDocument from "./redactionDocument";
import RedactionReview from "./redactionReview";

export default function RedactionIndex() {
	return (
		<Routes>
			<Route path="/" element={<RedactionAi />} />
			<Route path="/document" element={<RedactionDocument />} />
			<Route path="/review" element={<RedactionReview />} />
		</Routes>
	);
}
