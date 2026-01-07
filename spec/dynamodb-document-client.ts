/**
 * @file DynamoDB document client stub for unit tests.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const createDocumentClientStub = (props: {
	respond: (command: unknown, callIndex: number) => Promise<unknown>;
}): {
	documentClient: DynamoDBDocumentClient;
	sendCalls: unknown[];
} => {
	const client = new DynamoDBClient({
		region: "us-east-1",
		credentials: {
			accessKeyId: "test-access-key",
			secretAccessKey: "test-secret-key",
		},
	});
	const documentClient = DynamoDBDocumentClient.from(client);
	const sendCalls: unknown[] = [];
	const state = { callIndex: 0 };

	const sendHandler: DynamoDBDocumentClient["send"] = async (command) => {
		sendCalls.push(command);
		const currentIndex = state.callIndex;
		state.callIndex += 1;
		return props.respond(command, currentIndex);
	};

	documentClient.send = sendHandler;
	return { documentClient, sendCalls };
};
