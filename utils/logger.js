/**
	* Simple Logger Utility
	* Just pass any data and get automatic file/line location
	* Usage: log(data) or log(data, 'optional label')
	*/

function log(data, label = null) {
	// Get stack trace to find caller location
	const stack = new Error().stack;
	const stackLines = stack.split('\n');

	// Find the caller (skip this function and Error constructor)
	let callerInfo = 'Unknown location';
	if (stackLines.length > 2) {
		const callerLine = stackLines[2].trim();

		// Extract file path and line number using regex
		const match = callerLine.match(/at .* \((.+):(\d+):(\d+)\)/) ||
			callerLine.match(/at (.+):(\d+):(\d+)/);

		if (match) {
			const filePath = match[1];
			const lineNumber = match[2];
			const columnNumber = match[3];

			// Get just the filename from full path
			const fileName = filePath.split(/[/\\]/).pop();
			callerInfo = `${fileName}:${lineNumber}:${columnNumber}`;
		}
	}

	// Format timestamp
	const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];

	// Create formatted output
	const prefix = `[${timestamp}] 📍 ${callerInfo}`;

	if (label) {
		console.log(`${prefix} 🏷️  ${label}:`);
	} else {
		console.log(`${prefix} 📊 Data:`);
	}

	// Log the actual data with proper formatting
	if (typeof data === 'object' && data !== null) {
		console.log(JSON.stringify(data, null, 2));
	} else {
		console.log(data);
	}

}
	// Additional utility functions for different types of logging
	function logError(error, context = null) {
		const stack = new Error().stack;
		const stackLines = stack.split('\n');

		let callerInfo = 'Unknown location';
		if (stackLines.length > 2) {
			const callerLine = stackLines[2].trim();
			const match = callerLine.match(/at .* \((.+):(\d+):(\d+)\)/) ||
				callerLine.match(/at (.+):(\d+):(\d+)/);

			if (match) {
				const fileName = match[1].split(/[/\\]/).pop();
				callerInfo = `${fileName}:${match[2]}:${match[3]}`;
			}
		}

		const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];

		console.error(`[${timestamp}] 📍 ${callerInfo} ❌ ERROR:`);
		if (context) console.error(`Context: ${context}`);
		console.error(error);
		console.error('─'.repeat(60));
	}

	function logSuccess(message, data = null) {
		const stack = new Error().stack;
		const stackLines = stack.split('\n');

		let callerInfo = 'Unknown location';
		if (stackLines.length > 2) {
			const callerLine = stackLines[2].trim();
			const match = callerLine.match(/at .* \((.+):(\d+):(\d+)\)/) ||
				callerLine.match(/at (.+):(\d+):(\d+)/);

			if (match) {
				const fileName = match[1].split(/[/\\]/).pop();
				callerInfo = `${fileName}:${match[2]}:${match[3]}`;
			}
		}

		const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];

		console.log(`[${timestamp}] 📍 ${callerInfo} ✅ SUCCESS: ${message}`);
		if (data) {
			if (typeof data === 'object' && data !== null) {
				console.log(JSON.stringify(data, null, 2));
			} else {
				console.log(data);
			}
		}
		console.log('─'.repeat(60));
	}


	module.exports = {
		log,
		logError,
		logSuccess
	}
