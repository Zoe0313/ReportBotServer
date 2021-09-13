import logger from '../../common/logger.js'
import { v4 as uuidv4 } from 'uuid'
import {
   loadBlocks, getConversationsName, getUserTz, findBlockById, tryAndHandleError
} from '../../common/slack-helper.js'

import { SlackbotApiToken } from '../model/api-token.js'

async function getApiTokenForUser(userId) {
   let tokenResult = await SlackbotApiToken.findOne({'id': userId})
   if (tokenResult == null) {
      return null
   }
   return tokenResult.token
}

async function generateApiTokenForUser(userId) {
	token = uuidv4().replaceAll('-', '')
	await SlackbotApiToken.findOneAndUpdate({id: userId},
														 {id: userId, token: token},
														 {upsert: true})
	return token
}

export function registerRequestApiTokenServiceHandler(app) {

	async function requestApiToken(ack, body, client) {
		logger.info("Request api token for " + body.user?.id)

		userId = body.user?.id
		if (userId == null) {
         throw new Error('User is none in body, can not generate API token.')
		}

		token = await generateApiTokenForUser(userId)
		client.chat.postMessage({
			channel: userId,
			text: "Your API token: " + token,
		})
	}

   // Request API token
   app.action({
      block_id: 'block_welcome',
      action_id: 'action_history'
   }, async ({ ack, body, client }) => {
      tryAndHandleError({ ack, body, client }, async() => {
         await requestApiToken(ack, body, client)
      }, 'Failed to display notification sent history list.')
   })
}
