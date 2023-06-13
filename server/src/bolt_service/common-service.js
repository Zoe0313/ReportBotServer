import { LoadBlocks, UpdateUserTzCache } from '../../common/slack-helper.js'
import logger from '../../common/logger.js'
import { SlashCommandHandler } from '../slashcommand/handler.js'
export function RegisterCommonServiceHandler(app) {
   // Reply in channel
   // app.event('app_mention', async ({ event, say }) => {
   //    await say(`Hi, <@${event.user}>. ` +
   //       `I'm a little shy in public, but I'll follow up you by direct message.`)
   // })

   // Home page
   app.event('app_home_opened', async ({ client, event, logger }) => {
      try {
         await client.views.publish({
            user_id: event.user,
            view: {
               type: 'home',
               private_metadata: event.channel,
               callback_id: 'home_view',
               blocks: LoadBlocks('welcome')
            }
         })
      } catch (e) {
         logger.error(`Error publishing home tab: ${e}`)
      }
   })

   // Hi page
   app.message(/^(hi|hello|hey|help)/i, async ({ say }) => {
      await say({
         blocks: LoadBlocks('welcome'),
         text: 'Select an action'
      })
   })

   // user profile change
   app.event('user_change', async ({ payload }) => {
      const userId = payload?.user?.id
      const tz = payload?.user?.tz
      try {
         if (tz != null) {
            UpdateUserTzCache(userId, tz)
         }
      } catch (e) {
         logger.error(`Failed to update tz when user_change event happened. ` +
            `Payload: ${JSON.stringify(payload)}. ` + `Error: ${JSON.stringify(e)}`)
         throw e
      }
   })

   // slash command
   app.command('/whois-vsan-nanny', async ({ client, payload, ack }) => {
      await SlashCommandHandler(client, payload, ack)
   })
   app.command('/whois-nanny', async ({ client, payload, ack }) => {
      await SlashCommandHandler(client, payload, ack)
   })
}
