import logger from '../../common/logger.js'
import { v4 as uuidv4 } from 'uuid'
import { GetUsersName, TryAndHandleError } from '../../common/slack-helper.js'
import { SlackbotApiToken } from '../model/api-token.js'

async function RequestApiTokenForUser(userId, regenerate) {
   if (userId == null) {
      throw Error('user id is null when generating API token.')
   }
   const token = uuidv4().toString().replace(/-/g, '')
   let apiToken = await SlackbotApiToken.findOne({ userId })
   if (apiToken == null) {
      const userName = (await GetUsersName([userId]))[0]
      apiToken = new SlackbotApiToken({
         userId,
         userName,
         token
      })
      await apiToken.save()
   } else if (regenerate) {
      apiToken.token = token
      await apiToken.save()
   }
   return apiToken.token
}

async function QueryApiTokenForUser(userId) {
   if (userId == null) {
      throw Error('user id is required for querying API token.')
   }

   const apiToken = await SlackbotApiToken.findOne({ userId })
   if (apiToken == null) {
      return null
   }
   return apiToken.token
}

export function RegisterRequestApiTokenServiceHandler(app) {
   async function RequestApiToken(ack, body, client, regenerate = false) {
      logger.info('Request api token for ' + body.user?.id)
      const userId = body.user?.id
      if (userId == null) {
         throw new Error('User is none in body, can not generate API token.')
      }
      const token = await RequestApiTokenForUser(userId, regenerate)
      await ack()
      const blocks = [{
         type: 'section',
         text: {
            type: 'mrkdwn',
            text: `Your Api token is ${token}`
         },
         accessory: {
            type: 'button',
            text: {
               type: 'plain_text',
               text: 'Regenerate'
            },
            action_id: 'action_regenerate_api_token'
         }
      }]
      if (regenerate && body.message.ts != null) {
         await client.chat.update({
            ts: body.message.ts,
            channel: body.channel.id,
            text: 'Re-generated token',
            blocks
         })
      } else {
         await client.chat.postMessage({
            channel: userId,
            text: 'Generated token',
            blocks
         })
      }
   }

   // Request API token
   app.action({
      block_id: 'block_welcome',
      action_id: 'action_request_api_token'
   }, async ({ ack, body, client }) => {
      TryAndHandleError({ ack, body, client }, async () => {
         await RequestApiToken(ack, body, client)
      }, 'Failed to request API token of current user.')
   })

   // Regenerate API token
   app.action('action_regenerate_api_token', async ({ ack, body, client }) => {
      TryAndHandleError({ ack, body, client }, async () => {
         await RequestApiToken(ack, body, client, true)
      }, 'Failed to regenerate API token of current user.')
   })

   app.message(/^my\s+token/i, async ({ say, body }) => {
      const userId = body.event?.user
      const token = await QueryApiTokenForUser(userId)
      if (token == null) {
         await say('You don\'t have token requested')
      } else {
         await say('Your API token is ' + token)
      }
   })
}
